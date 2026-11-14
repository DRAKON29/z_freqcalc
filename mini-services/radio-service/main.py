# -*- coding: utf-8 -*-
"""
FastAPI-сервис калькулятора распространения радиоволн.

Эндпоинты:
  GET  /api/health             — состояние сервиса
  GET  /api/capabilities       — возможности моделей
  POST /api/calculate          — расчёт (P.2001 / FSPL+P.526) + бюджет линии
  POST /api/maps/upload        — загрузка карт ITU (.txt/.zip, 700 МБ/1 ГБ, 413)
  GET  /api/maps/status        — список карт
  DELETE /api/maps/{name}      — удаление карты
  GET  /api/clutter?bbox=      — clutter.geojson
  POST /api/clutter            — загрузка clutter.geojson (валидация type/height)
  GET/POST /api/history        — история расчётов (device_id, без авторизации)
  DELETE /api/history/{id}     — удаление записи истории
  GET  /api/dem?points=...     — DEM-прокси (AWS Terrain Tiles / Copernicus GLO-30)

Безопасность: CORS, rate limiting, валидация, лимиты размеров, 413.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sqlite3
import time
import uuid
import zipfile
from pathlib import Path

import fastapi
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from p2001_lite import (
    calculate as p2001_calculate,
    compute_budget,
    doppler_loss_db as doppler_loss_db_fn,
    p2001_lite_calculate,
)

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("RADIO_DATA_DIR", APP_DIR / "data"))
ITU_MAPS_DIR = DATA_DIR / "itu_maps"
CLUTTER_FILE = DATA_DIR / "clutter" / "clutter.geojson"
HISTORY_DB = DATA_DIR / "history" / "history.db"
SRTM_DIR = DATA_DIR / "srtm"
P452_MAPS_DIR = DATA_DIR / "p452_maps"
P452_NPZ = DATA_DIR / "p452" / "P452.npz"
P2001_MAPS_DIR = DATA_DIR / "p2001_maps"
P2001_NPZ = DATA_DIR / "p2001" / "P2001.npz"

for d in [ITU_MAPS_DIR, CLUTTER_FILE.parent, HISTORY_DB.parent, SRTM_DIR, P452_MAPS_DIR, P452_NPZ.parent, P2001_MAPS_DIR, P2001_NPZ.parent]:
    d.mkdir(parents=True, exist_ok=True)

# Вендоренный P.452 (p452_port) читает P452.npz по этому пути при импорте
os.environ.setdefault("RADIO_P452_NPZ", str(P452_NPZ))
# Вендоренный Py2001 (p2001_port, полная P.2001-6) читает P2001.npz по этому пути при импорте
os.environ.setdefault("RADIO_P2001_NPZ", str(P2001_NPZ))

MAX_FILE_BYTES = 700 * 1024 * 1024   # 700 МБ на файл
MAX_ZIP_BYTES = 1024 * 1024 * 1024   # 1 ГБ на zip

app = FastAPI(title="Калькулятор распространения радиоволн — сервис", version="1.0.0")

# CORS
CORS_ORIGINS = os.environ.get("RADIO_CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Rate limiting (in-memory sliding window) ----------

RATE_LIMIT_CALC = int(os.environ.get("RADIO_RATE_CALC", "60"))      # req/мин
RATE_LIMIT_UPLOAD = int(os.environ.get("RADIO_RATE_UPLOAD", "10"))  # req/мин
_buckets: dict[str, list[float]] = {}


def rate_limit(request: Request, limit_per_min: int, bucket: str) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{ip}"
    now = time.time()
    window = _buckets.setdefault(key, [])
    while window and window[0] < now - 60:
        window.pop(0)
    if len(window) >= limit_per_min:
        raise HTTPException(status_code=429, detail="Превышен лимит запросов. Повторите позже.")
    window.append(now)


# ---------- История: SQLite ----------

def history_conn():
    conn = sqlite3.connect(HISTORY_DB)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            name TEXT,
            model TEXT,
            engine_used TEXT,
            backend TEXT,
            frequency_mhz REAL,
            distance_km REAL,
            median_loss_db REAL,
            link_margin_db REAL,
            payload TEXT
        )"""
    )
    return conn


# ---------- Карты ITU: валидация ----------

_NUM_TOKEN_RE = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")


def _looks_like_numeric_grid(text: str) -> bool:
    """Официальные таблицы ITU-R P.2001 (DN_Median, DN_SubSlope, DN_SupSlope,
    dndz_01, Esarain_*, FoEs* и т.п.) — числовые сетки без заголовка key = value.
    Проверяем, что файл — матрица чисел (≥2 строки по ≥3 числа)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False
    for ln in lines[:50]:
        tokens = ln.split()
        if len(tokens) < 3 or any(not _NUM_TOKEN_RE.match(t) for t in tokens):
            return False
    return True


def validate_itu_txt(text: str) -> None:
    """Проверка карты ITU: заголовок key = value (с version) ИЛИ числовая сетка
    официальных таблиц ITU-R P.2001, поставляемых без заголовка."""
    if len(text) < 10:
        raise HTTPException(422, "Файл карты слишком мал или пуст")
    header_ok = False
    has_version = False
    for line in text.splitlines()[:200]:
        line = line.strip()
        if "=" in line:
            header_ok = True
            key = line.split("=")[0].strip().lower()
            if key == "version":
                has_version = True
    if not header_ok:
        if _looks_like_numeric_grid(text):
            return
        raise HTTPException(
            422,
            "Не найден заголовок карты ITU (строки вида key = value); "
            "содержимое также не является числовой сеткой ITU-R P.2001",
        )
    if not has_version:
        raise HTTPException(422, "В карте ITU не найдено поле version")


def validate_itu_zip(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()
    except zipfile.BadZipFile:
        raise HTTPException(422, "Архив повреждён (не ZIP)")
    txt = [n for n in names if n.lower().endswith(".txt")]
    if not txt:
        raise HTTPException(422, "В архиве нет .txt файла карты ITU")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open(txt[0]) as f:
            head = f.read(65536).decode("utf-8", errors="replace")
    validate_itu_txt(head)


# ---------- Эндпоинты ----------

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "py2001": _py2001_available(),
        "p452": _p452_available(),
        "maps": _maps_count(),
    }


def _py2001_available() -> bool:
    """Полная P.2001-6 (вендоренный порт Py2001): импорт падает без P2001.npz
    (цифровые карты ITU не распространяются с репозиторием) — это ожидаемое
    состояние «недоступна», расчёт уходит в P.2001-lite."""
    try:
        import p2001_port  # noqa: F401
        return True
    except Exception:
        return False


def _p452_available() -> bool:
    """P.452-18 (вендоренный порт Py452): импорт падает без P452.npz
    (цифровые карты ITU не распространяются с репозиторием) — это
    ожидаемое состояние «недоступен», клиент уходит в TS-фоллбек."""
    try:
        import p452_port  # noqa: F401
        return True
    except Exception:
        return False


def _itm_available() -> bool:
    try:
        import itm_model  # noqa: F401
        return True
    except Exception:
        return False


def _maps_count() -> int:
    return len(list(ITU_MAPS_DIR.glob("*")))


@app.get("/api/capabilities")
def capabilities():
    p2001 = _py2001_available()
    p452 = _p452_available()
    return {
        "p2001": {
            "available": True,
            "referenceImplementation": p2001,
            "engine": "P.2001-6 (Py2001, вендоренный порт ITU-R WP 3M; карты ITU)"
            if p2001
            else "P.2001-lite (аппроксимация, без карт)",
            "supportsMaps": p2001,
        },
        "fspl-p526": {"available": True, "engine": "py: FSPL + P.526 + P.838/P.676/P.833"},
        "itm": {"available": _itm_available(), "engine": "py: Longley-Rice ITM v1.2.2 (порт NTIA/ITS, роадмап 2.1)"},
        "p452": {
            "available": p452,
            "engine": "P.452-18 (Py452, вендоренный порт; карты N050/DN50)" if p452 else "недоступен: соберите P452.npz (scripts/build_p452_npz.py)",
        },
    }


@app.post("/api/calculate")
async def api_calculate(request: Request):
    rate_limit(request, RATE_LIMIT_CALC, "calc")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Некорректный JSON")
    model = body.get("model", "fspl-p526")
    inp = body.get("input")
    equipment = body.get("equipment")
    if not inp:
        raise HTTPException(400, "Отсутствует input")
    _validate_input(inp)

    if model == "p2001" and _py2001_available():
        # Полная P.2001-6 (роадмап 2.6): вендоренный порт Py2001 + P2001.npz
        # (карты ITU). Без координат концов трассы или при ошибке — lite.
        try:
            from p2001_model import calculate_full
            result = calculate_full(
                inp, engine_note="P.2001-6(ITU-R WP 3M)"
            )
        except Exception as e:
            result = p2001_calculate(inp, engine_note="py: P.2001-lite (fallback от Py2001)")
            result["warnings"].insert(0, f"P.2001-6 недоступна: {e} — выполнен расчёт P.2001-lite")
    elif model == "p2001":
        result = p2001_calculate(inp, engine_note="py: P.2001-lite (статистическая аппроксимация)")
    elif model == "itm":
        # Longley-Rice ITM (роадмап 2.1): вендоренный порт NTIA/ITS v1.2.2
        try:
            from itm_model import itm_calculate
            result = itm_calculate(inp, engine_note="py: Longley-Rice ITM v1.2.2 (медиана 50 % времени)")
        except Exception as e:
            raise HTTPException(400, f"ITM: не удалось выполнить расчёт ({e})")
    else:
        # FSPL + P.526: тот же движок, модель детерминированная
        result = p2001_calculate(inp, engine_note="py: FSPL (P.525) + P.526")
        result["model"] = "fspl-p526"
        result["byTimePercent"] = [{"percent": 50, "lossDb": result["medianLossDb"]}]

    # Бюджет линии, если передано оборудование
    budget = None
    if equipment:
        dop = float(body.get("dopplerLossDb") or 0)
        budget = compute_budget(inp, equipment, result, dop)
    return {"propagation": result, "budget": budget}


@app.post("/api/interference")
async def interference_post(request: Request):
    """Путь помехи по ITU-R P.452-18 (роадмап 2.3): для каждого пути (источник
    помехи → жертва) и каждого процента времени p считает базовые потери
    bt_loss по готовому профилю от клиента. Модель полезной линии не трогает —
    вызывается клиентом отдельно от /api/calculate."""
    rate_limit(request, RATE_LIMIT_CALC, "calc")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Некорректный JSON")

    if not _p452_available():
        raise HTTPException(
            400,
            "P.452 недоступен: вендоренный порт Py452 не загрузился — "
            "соберите P452.npz (scripts/build_p452_npz.py; карты N050.TXT/DN50.TXT "
            "скачиваются с сайта ITU, см. scripts/download_p452_maps.ps1)",
        )

    paths = body.get("paths")
    if not isinstance(paths, list) or not paths:
        raise HTTPException(400, "Отсутствуют paths (пути помехи)")
    freq = float(body.get("frequencyMhz", 0))
    if not (500 <= freq <= 7000):
        raise HTTPException(422, f"Частота {freq} МГц вне диапазона 500–7000 МГц")
    pol_code = 1 if (body.get("polarization") or "vertical") == "horizontal" else 2
    zone = body.get("zone", 2)
    if zone not in (1, 2, 3):
        raise HTTPException(422, f"Радиоклиматическая зона {zone} вне 1/2/3")
    press = float(body.get("pressHPa", 1013))
    temp = float(body.get("tempC", 15))
    ps_raw = body.get("p", [50])
    if not isinstance(ps_raw, list) or not ps_raw:
        raise HTTPException(400, "Отсутствует p (список процентов времени)")
    ps = [float(x) for x in ps_raw]
    if any(not (0.001 <= x <= 50) for x in ps):
        raise HTTPException(422, "Проценты времени p вне диапазона 0.001–50 %")

    try:
        import numpy as np
        from p452_port import bt_loss

        results: dict[str, dict[str, float]] = {}
        for path in paths:
            pid = str(path.get("id", "path"))
            prof = path.get("profile") or {}
            d_arr, h_arr, g_arr = prof.get("d"), prof.get("h"), prof.get("g")
            if not (isinstance(d_arr, list) and isinstance(h_arr, list) and isinstance(g_arr, list)):
                raise HTTPException(422, f"Путь {pid}: profile.d/h/g — массивы")
            if len(d_arr) < 4:
                raise HTTPException(422, f"Путь {pid}: P.452 требует минимум 4 точки профиля")
            if not (len(d_arr) == len(h_arr) == len(g_arr)):
                raise HTTPException(422, f"Путь {pid}: длины d/h/g не совпадают")
            htg = float(path.get("txHeightM", 0))
            hrg = float(path.get("rxHeightM", 0))
            if not (0.5 <= htg <= 5000 and 0.5 <= hrg <= 5000):
                raise HTTPException(422, f"Путь {pid}: высоты антенн вне диапазона 0.5–5000 м")
            src = path.get("source") or {}
            vic = path.get("victim") or {}
            try:
                phit_e, phit_n = float(src["lon"]), float(src["lat"])
                phir_e, phir_n = float(vic["lon"]), float(vic["lat"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, f"Путь {pid}: некорректные координаты source/victim")

            d_km = np.asarray(d_arr, dtype=float) / 1000.0
            if np.any(np.diff(d_km) < 0):
                raise HTTPException(422, f"Путь {pid}: профиль d должен быть возрастающим")
            h_m = np.asarray(h_arr, dtype=float)
            g_m = np.asarray(g_arr, dtype=float)
            zone_arr = np.full(len(d_km), int(zone))

            entry: dict[str, float] = {}
            for p in ps:
                loss = bt_loss(
                    freq / 1000.0, p, d_km, h_m, g_m, zone_arr, htg, hrg,
                    phit_e, phit_n, phir_e, phir_n,
                    0, 0,          # Gt/Gr: усиления жертв/помехи применяются на клиенте
                    pol_code, 0, 0,  # dct/dcr: внутренние трассы, без выхода к морю
                    press, temp,
                )
                entry[f"{p:g}"] = float(loss)
            results[pid] = entry
        return {"results": results, "engineUsed": "P.452-18 (Py452, вендоренный порт)", "warnings": []}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"P.452: не удалось выполнить расчёт ({e})")


def _validate_input(inp: dict) -> None:
    try:
        f = float(inp["frequencyMhz"])
        if not (500 <= f <= 7000):
            raise ValueError(f"Частота {f} МГц вне диапазона 500–7000 МГц")
        path = inp["path"]
        d = float(path["distanceM"])
        if not (10 <= d <= 300_000):
            raise ValueError(f"Длина трассы {d} м вне диапазона 10 м…300 км")
        if not isinstance(path.get("profile"), list) or len(path["profile"]) < 3:
            raise ValueError("Профиль трассы должен содержать минимум 3 точки")
        for k_, v_ in (("txHeightM", inp.get("txHeightM", 0)), ("rxHeightM", inp.get("rxHeightM", 0))):
            if not (0.5 <= float(v_) <= 5000):
                raise ValueError(f"Высота антенны {k_}={v_} м вне диапазона 0.5–5000 м")
    except KeyError as e:
        raise HTTPException(400, f"Отсутствует обязательное поле: {e}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/api/maps/upload")
async def maps_upload(request: Request, files: list[UploadFile] = File(...)):
    rate_limit(request, RATE_LIMIT_UPLOAD, "upload")
    uploaded: list[dict] = []
    failed: list[dict] = []
    first_error: HTTPException | None = None
    for file in files:
        name = file.filename or "map.txt"
        try:
            uploaded.append(await _save_itu_map(file, name))
        except HTTPException as e:
            failed.append({"name": name, "status": e.status_code, "detail": e.detail})
            if first_error is None or (e.status_code == 413 and first_error.status_code != 413):
                first_error = e
    if failed and not uploaded:
        assert first_error is not None
        raise HTTPException(first_error.status_code, f"{failed[0]['name']}: {first_error.detail}")
    return {"ok": True, "uploaded": uploaded, "failed": failed}


async def _save_itu_map(file: UploadFile, name: str) -> dict:
    ext = name.lower().rsplit(".", 1)[-1]
    if ext not in ("txt", "zip"):
        raise HTTPException(422, f"Недопустимое расширение .{ext} — ожидается .txt или .zip")

    data = await file.read()
    if ext == "txt" and len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, f"Файл {len(data)/1e6:.0f} МБ превышает лимит 700 МБ")
    if ext == "zip" and len(data) > MAX_ZIP_BYTES:
        raise HTTPException(413, f"Архив {len(data)/1e6:.0f} МБ превышает лимит 1 ГБ")

    if ext == "zip":
        validate_itu_zip(data)
    else:
        validate_itu_txt(data.decode("utf-8", errors="replace"))

    target = ITU_MAPS_DIR / Path(name).name
    target.write_bytes(data)
    return {"name": target.name, "size": len(data)}


@app.get("/api/maps/status")
def maps_status():
    maps = []
    for p in sorted(ITU_MAPS_DIR.iterdir()):
        if p.is_file():
            maps.append({"name": p.name, "size": p.stat().st_size, "modified": p.stat().st_mtime})
    return {"maps": maps, "py2001": _py2001_available()}


@app.delete("/api/maps/{name}")
def maps_delete(name: str):
    target = ITU_MAPS_DIR / Path(name).name
    if not target.exists():
        raise HTTPException(404, f"Карта {name} не найдена")
    target.unlink()
    return {"ok": True}


# ---------- Тайлы SRTM (.hgt): список + раздача для автоподкачки клиента ----------

_SRTM_NAME_RE = re.compile(r"^[NS]\d{2}[EW]\d{3}$")


@app.get("/api/srtm")
def srtm_list():
    tiles = []
    for p in sorted(SRTM_DIR.iterdir()):
        if p.is_file() and p.suffix.lower() == ".hgt":
            tiles.append({"name": p.stem, "size": p.stat().st_size, "modified": p.stat().st_mtime})
    return {"tiles": tiles}


@app.get("/api/srtm/{name}")
def srtm_tile(name: str, request: Request):
    rate_limit(request, RATE_LIMIT_UPLOAD, "srtm")
    if not _SRTM_NAME_RE.match(name):
        raise HTTPException(422, "Имя тайла должно быть вида N44E033")
    target = SRTM_DIR / f"{name}.hgt"
    if not target.is_file():
        raise HTTPException(404, f"Тайл {name} не найден на сервере")
    data = target.read_bytes()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/clutter")
def clutter_get(bbox: str | None = None):
    if not CLUTTER_FILE.exists():
        return {"type": "FeatureCollection", "features": []}
    gj = json.loads(CLUTTER_FILE.read_text(encoding="utf-8"))
    if bbox:
        try:
            min_lon, min_lat, max_lon, max_lat = [float(v) for v in bbox.split(",")]
        except ValueError:
            raise HTTPException(400, "bbox=minLon,minLat,maxLon,maxLat")
        feats = []
        for f in gj.get("features", []):
            g = f.get("geometry")
            if not g:
                continue
            rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [c[0] for c in g.get("coordinates", [])]
            for ring in rings:
                xs = [pt[0] for pt in ring]
                ys = [pt[1] for pt in ring]
                if max(xs) >= min_lon and min(xs) <= max_lon and max(ys) >= min_lat and min(ys) <= max_lat:
                    feats.append(f)
                    break
        gj = {"type": "FeatureCollection", "features": feats}
    return gj


@app.post("/api/clutter")
async def clutter_post(request: Request, file: UploadFile = File(...)):
    rate_limit(request, RATE_LIMIT_UPLOAD, "clutter")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "clutter.geojson больше 50 МБ")
    try:
        gj = json.loads(data)
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"Некорректный JSON: {e}")
    if gj.get("type") != "FeatureCollection" or not isinstance(gj.get("features"), list):
        raise HTTPException(422, "Ожидается FeatureCollection")
    for f in gj["features"]:
        props = f.get("properties") or {}
        t = props.get("type")
        if t and t not in ("building", "vegetation"):
            raise HTTPException(422, f"Недопустимый type: {t} (building | vegetation)")
        h = props.get("height")
        if h is not None and not isinstance(h, (int, float)):
            raise HTTPException(422, "height должен быть числом")
    CLUTTER_FILE.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "features": len(gj["features"])}


@app.get("/api/history")
def history_get(request: Request, device_id: str, limit: int = 100):
    rate_limit(request, RATE_LIMIT_CALC, "history")
    conn = history_conn()
    rows = conn.execute(
        "SELECT id, device_id, created_at, name, model, engine_used, backend, frequency_mhz,"
        " distance_km, median_loss_db, link_margin_db, payload FROM history"
        " WHERE device_id = ? ORDER BY created_at DESC LIMIT ?",
        (device_id, min(limit, 1000)),
    ).fetchall()
    conn.close()
    entries = []
    for r in rows:
        try:
            payload = json.loads(r[11]) if r[11] else {}
        except json.JSONDecodeError:
            payload = {}
        entries.append(
            {"id": r[0], "deviceId": r[1], "createdAt": r[2], "name": r[3], "model": r[4],
             "engineUsed": r[5], "backend": r[6], "frequencyMhz": r[7], "distanceKm": r[8],
             "medianLossDb": r[9], "linkMarginDb": r[10], **payload}
        )
    return {"entries": entries}


@app.post("/api/history")
async def history_post(request: Request):
    rate_limit(request, RATE_LIMIT_CALC, "history")
    body = await request.json()
    device_id = body.get("device_id")
    entry = body.get("entry") or {}
    if not device_id:
        raise HTTPException(400, "device_id обязателен (анонимная привязка,)")
    conn = history_conn()
    cur = conn.execute(
        "INSERT INTO history (device_id, created_at, name, model, engine_used, backend,"
        " frequency_mhz, distance_km, median_loss_db, link_margin_db, payload)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            device_id,
            entry.get("createdAt") or "",
            entry.get("name") or "Расчёт",
            entry.get("model") or "",
            entry.get("engineUsed") or "",
            entry.get("backend") or "",
            entry.get("frequencyMhz") or 0,
            entry.get("distanceKm") or 0,
            entry.get("medianLossDb") or 0,
            entry.get("linkMarginDb") or 0,
            json.dumps(entry, ensure_ascii=False),
        ),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    return {"ok": True, "id": row_id}


@app.delete("/api/history/{row_id}")
def history_delete(row_id: int, request: Request, device_id: str):
    rate_limit(request, RATE_LIMIT_CALC, "history")
    conn = history_conn()
    cur = conn.execute("DELETE FROM history WHERE id = ? AND device_id = ?", (row_id, device_id))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if not deleted:
        raise HTTPException(404, "Запись не найдена")
    return {"ok": True}


# ---------- DEM-прокси: AWS Terrain Tiles (Copernicus GLO-30 / SRTM,) ----------

@app.get("/api/dem")
def dem_proxy(request: Request, lat: float, lon: float, zoom: int = 11):
    """Высота в точке через публичные Terrarium-тайлы AWS (без ключей).

    zoom=11 ≈ 76 м/пиксель на экваторе; тайл кэшируется в ./data/dem.
    """
    import urllib.request

    rate_limit(request, RATE_LIMIT_CALC, "dem")
    n_tiles = 2**zoom
    x_f = (lon + 180.0) / 360.0 * n_tiles
    lat_rad = math.radians(lat)
    y_f = (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n_tiles
    x, y = int(x_f) % n_tiles, int(y_f) % n_tiles

    cache = DATA_DIR / "dem"
    cache.mkdir(parents=True, exist_ok=True)
    tile_path = cache / f"{zoom}_{x}_{y}.png"

    try:
        if not tile_path.exists():
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png"
            req = urllib.request.Request(url, headers={"User-Agent": "radio-propagation-calc/1.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                tile_path.write_bytes(r.read())
        from PIL import Image
        img = Image.open(tile_path).convert("RGB")
        px = min(img.width - 1, max(0, int((x_f - x) * img.width)))
        py = min(img.height - 1, max(0, int((y_f - y) * img.height)))
        r_, g_, b_ = img.getpixel((px, py))
        elev = r_ * 256 + g_ + b_ / 256 - 32768
        return {"elev": round(elev, 1), "source": "AWS Terrain Tiles (Copernicus GLO-30/SRTM)", "zoom": zoom}
    except Exception as e:
        raise HTTPException(502, f"DEM недоступен: {e}. Используется синтетический рельеф в UI.")


# ---------- Экспорт CSV ----------

@app.post("/api/export/csv", response_class=PlainTextResponse)
async def export_csv(request: Request):
    body = await request.json()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Секция", "Параметр", "Значение"])
    for section, rows in body.items():
        if isinstance(rows, dict):
            for k, v in rows.items():
                w.writerow([section, k, v])
    return buf.getvalue()


# Точка входа Pyodide-совместимого модуля (для /py/p2001_lite.py раздаётся отдельная копия)
@app.get("/api/py/p2001_lite.py")
def py_module():
    return PlainTextResponse((APP_DIR / "p2001_lite.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
