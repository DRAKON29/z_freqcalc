#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка P452.npz для вендоренного P.452-18 (этап 2.3 «Интерференция C/I»).

Цифровые карты ITU (N050.TXT, DN50.TXT) не распространяются с репозиторием —
скачайте их с сайта ITU-R (страница рекомендации P.452-18, раздел данных /
SG3 software & validation) и положите в каталог карт (по умолчанию
mini-services/radio-service/data/p452_maps/). Скрипт читает TXT и собирает
NPZ в data/p452/P452.npz — путь, который main.py подставляет в env
RADIO_P452_NPZ для вендоренного p452_port.

Использование:
    python scripts/build_p452_npz.py [--maps-dir DIR] [--output FILE]

См. также: scripts/download_p452_maps.ps1 (Windows, curl.exe).
"""
import argparse
import os
import sys

import numpy as np

REQUIRED = ("DN50.TXT", "N050.TXT")


def main() -> int:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_maps = os.path.join(repo, "mini-services", "radio-service", "data", "p452_maps")
    default_out = os.path.join(repo, "mini-services", "radio-service", "data", "p452", "P452.npz")

    ap = argparse.ArgumentParser(description="Сборка P452.npz из карт ITU (N050/DN50)")
    ap.add_argument("--maps-dir", default=default_maps, help="каталог с N050.TXT и DN50.TXT")
    ap.add_argument("--output", default=default_out, help="путь результата P452.npz")
    args = ap.parse_args()

    maps: dict[str, "np.ndarray"] = {}
    failed = False
    for name in REQUIRED:
        path = os.path.join(args.maps_dir, name)
        try:
            matrix = np.loadtxt(path)
            maps[name[:-4]] = matrix
            print(f"OK: {name} — {matrix.shape}")
        except OSError as e:
            print(f"ОШИБКА: {name} не найден в {args.maps_dir} ({e})")
            failed = True
        except ValueError as e:
            print(f"ОШИБКА: {name} содержит нечисловые данные ({e})")
            failed = True

    if failed or not maps:
        print("\nСборка не выполнена. Скачайте карты ITU-R P.452-18 (N050.TXT, DN50.TXT) —")
        print("см. scripts/download_p452_maps.ps1 или README, раздел «Интерференция C/I».")
        return 1

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    np.savez(args.output, **maps)
    print(f"P452.npz создан: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
