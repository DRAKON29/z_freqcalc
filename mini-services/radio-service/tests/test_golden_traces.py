# -*- coding: utf-8 -*-
"""
Кросс-движковая golden-валидация lite-движков (роадмап 3.4, допуск ±1 дБ —
подход Meshtastic Site Planner). Один fixtures-файл tests/fixtures/golden-traces.json
гоняется и здесь (python p2001_lite), и bun-тестом tests/golden-traces.test.ts:
каждый движок проверяется против СВОЕГО снапшота (±0.01 дБ — защита от регрессий)
и против снапшота ДРУГОГО движка (±1 дБ — зеркальность портов).

Регенерация снапшотов: bun scripts/gen_golden_traces.ts &&
python scripts/gen_golden_traces_py.py — только при намеренном изменении модели.
"""
import json
from pathlib import Path

import pytest

from p2001_lite import calculate

Repo = Path(__file__).resolve().parents[3]  # mini-services/radio-service/tests → repo
FIXTURE = Repo / "tests" / "fixtures" / "golden-traces.json"

_doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = _doc["cases"]
TOL_CROSS = float(_doc["toleranceCrossDb"])
TOL_SNAP = float(_doc["toleranceSnapshotDb"])


def _computed(case: dict) -> dict:
    result = calculate(case["input"], engine_note="golden")
    if case["name"].startswith("fspl_p526"):
        # детерминированная модель без временно́й изменчивости — точка 50 % (как в main.py)
        result["byTimePercent"] = [{"percent": 50.0, "lossDb": result["medianLossDb"]}]
    return result


def _assert_close(got: float, want: float, tol: float, what: str) -> None:
    assert abs(got - want) <= tol, f"{what}: {got:.3f} vs {want:.3f} дБ (допуск {tol})"


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
class TestGoldenTraces:
    def test_self_snapshot(self, case):
        """python-движок воспроизводит собственный снапшот (регресс-защита)."""
        r = _computed(case)
        _assert_close(r["medianLossDb"], case["py"]["medianLossDb"], TOL_SNAP, "medianLossDb")
        assert len(r["byTimePercent"]) == len(case["py"]["byTimePercent"])
        for got, want in zip(r["byTimePercent"], case["py"]["byTimePercent"]):
            assert got["percent"] == want["percent"]
            _assert_close(got["lossDb"], want["lossDb"], TOL_SNAP, f"byTime p={got['percent']}")
        for key, want in case["py"]["breakdown"].items():
            got = (r["breakdown"] or {}).get(key)
            assert got is not None, f"breakdown.{key} отсутствует в ответе python"
            _assert_close(got, want, TOL_SNAP, f"breakdown.{key}")

    def test_cross_engine_ts(self, case):
        """python-движок совпадает с TS-снапшотом в пределах ±1 дБ (зеркальность)."""
        r = _computed(case)
        _assert_close(r["medianLossDb"], case["ts"]["medianLossDb"], TOL_CROSS, "medianLossDb")
        assert len(r["byTimePercent"]) == len(case["ts"]["byTimePercent"])
        for got, want in zip(r["byTimePercent"], case["ts"]["byTimePercent"]):
            assert got["percent"] == want["percent"]
            _assert_close(got["lossDb"], want["lossDb"], TOL_CROSS, f"byTime p={got['percent']}")
