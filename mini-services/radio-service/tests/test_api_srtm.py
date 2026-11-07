# -*- coding: utf-8 -*-
"""API-тесты раздачи тайлов SRTM: GET /api/srtm и GET /api/srtm/{name}."""
import importlib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

import main as service


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Клиент с временной RADIO_DATA_DIR и одним валидным тайлом N44E033.

    DATA_DIR вычисляется при импорте main, поэтому после подмены env модуль
    перезагружается (пересоздаются DATA_DIR, SRTM_DIR и app).
    """
    monkeypatch.setenv("RADIO_DATA_DIR", str(tmp_path))
    importlib.reload(service)
    srtm_dir = tmp_path / "srtm"
    srtm_dir.mkdir(parents=True, exist_ok=True)
    # Валидный 1201×1201 int16 big-endian тайл (все высоты 0)
    (srtm_dir / "N44E033.hgt").write_bytes(struct.pack(">12001h", *([0] * 12001)))
    yield TestClient(service.app)
    # Возврат модуля к исходному окружению (env уже восстановлен monkeypatch при
    # teardown — reload безопасно выполняется в следующем тесте)
    monkeypatch.undo()
    importlib.reload(service)


def test_srtm_list(client):
    r = client.get("/api/srtm")
    assert r.status_code == 200
    body = r.json()
    assert body["tiles"][0]["name"] == "N44E033"
    assert body["tiles"][0]["size"] > 0


def test_srtm_tile_returns_bytes(client):
    r = client.get("/api/srtm/N44E033")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/octet-stream")
    assert "max-age=86400" in r.headers["cache-control"]
    assert len(r.content) == 12001 * 2  # 1201×1201 int16


def test_srtm_tile_not_found(client):
    assert client.get("/api/srtm/N99E099").status_code == 404


def test_srtm_tile_bad_name(client):
    # '..%2F..' — starlette не сматчит маршрут со слэшем (404); остальное отсекает валидатор (422)
    for bad, expected in [("N44X033", 422), ("n44e033", 422), ("N44E033.hgt", 422), ("N4E03", 422), ("..%2Fetc%2Fpasswd", (404, 422))]:
        status = client.get(f"/api/srtm/{bad}").status_code
        assert status == expected or (isinstance(expected, tuple) and status in expected), bad
