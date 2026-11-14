#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Дозаполнение py-снапшотов в tests/fixtures/golden-traces.json (роадмап 3.4):
python-движок p2001_lite.calculate по тем же входным, что и TS-генератор
(scripts/gen_golden_traces.ts). TS-снапшоты не трогаются.

Запуск из репозитория:
    mini-services/radio-service/.venv/Scripts/python.exe scripts/gen_golden_traces_py.py
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SVC = REPO / "mini-services" / "radio-service"
sys.path.insert(0, str(SVC))

from p2001_lite import calculate  # noqa: E402

FIXTURE = REPO / "tests" / "fixtures" / "golden-traces.json"


def snapshot(inp: dict, model: str) -> dict:
    result = calculate(inp, engine_note="golden")
    if model == "fspl-p526":
        # python-ветка fspl-p526 (как в main.py): детерминированная модель без
        # временно́й изменчивости — byTime = единственная точка 50 % с медианой
        result["byTimePercent"] = [{"percent": 50.0, "lossDb": result["medianLossDb"]}]
        result["model"] = "fspl-p526"
    breakdown = {
        k: round(v, 6) for k, v in result["breakdown"].items() if isinstance(v, (int, float))
    }
    return {
        "medianLossDb": round(float(result["medianLossDb"]), 6),
        "byTimePercent": [
            {"percent": float(t["percent"]), "lossDb": round(float(t["lossDb"]), 6)}
            for t in result["byTimePercent"]
        ],
        "breakdown": breakdown,
    }


def main() -> int:
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    filled = 0
    for case in doc["cases"]:
        model = "fspl-p526" if case["name"].startswith("fspl_p526") else "p2001"
        case["py"] = snapshot(case["input"], model)
        filled += 1
        ts = case.get("ts", {}).get("medianLossDb")
        py = case["py"]["medianLossDb"]
        delta = abs(ts - py) if ts is not None else float("nan")
        flag = "OK" if delta <= doc["toleranceCrossDb"] else "ПРЕВЫШЕНИЕ"
        print(f"{case['name']:28s} ts={ts:8.2f}  py={py:8.2f}  Δ={delta:6.2f} дБ  [{flag}]")
    FIXTURE.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"py-снапшоты записаны: {filled} шт.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
