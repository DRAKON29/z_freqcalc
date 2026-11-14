#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка P2001.npz для вендоренной полной P.2001-6 (p2001_port, роадмап 2.6).

Цифровые карты ITU (14 таблиц P.2001-6) не распространяются с репозиторием —
скачайте архив рекомендации P.2001-6 со страницы ITU-R (ZIP-E, раздел «Data»)
и распакуйте .txt в каталог карт (по умолчанию
mini-services/radio-service/data/p2001_maps/, либо --maps-dir D:\\itu\\P_2001-6).
Скрипт читает TXT и собирает NPZ в data/p2001/P2001.npz — путь, который
main.py подставляет в env RADIO_P2001_NPZ для вендоренного p2001_port.

Требуемые файлы (как в initiate_digital_maps.py оригинального Py2001):
  DN_Median.txt, DN_SubSlope.txt, DN_SupSlope.txt, dndz_01.txt,
  Esarain_Mt_v5.txt, Esarain_Pr6_v5.txt, Esarain_Beta_v5.txt,
  FoEs0.1.txt, FoEs01.txt, FoEs10.txt, FoEs50.txt,
  h0.txt, surfwv_50_fixed.txt, TropoClim.txt

Использование:
    python scripts/build_p2001_npz.py [--maps-dir DIR] [--output FILE]

См. также: scripts/download_p2001_maps.ps1 (Windows, curl.exe).
"""
import argparse
import os
import sys

import numpy as np

REQUIRED = (
    "DN_Median.txt",
    "DN_SubSlope.txt",
    "DN_SupSlope.txt",
    "dndz_01.txt",
    "Esarain_Mt_v5.txt",
    "Esarain_Pr6_v5.txt",
    "Esarain_Beta_v5.txt",
    "FoEs0.1.txt",
    "FoEs01.txt",
    "FoEs10.txt",
    "FoEs50.txt",
    "h0.txt",
    "surfwv_50_fixed.txt",
    "TropoClim.txt",
)


def main() -> int:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_maps = os.path.join(repo, "mini-services", "radio-service", "data", "p2001_maps")
    default_out = os.path.join(repo, "mini-services", "radio-service", "data", "p2001", "P2001.npz")

    ap = argparse.ArgumentParser(description="Сборка P2001.npz из 14 таблиц ITU-R P.2001-6")
    ap.add_argument("--maps-dir", default=default_maps, help="каталог с .txt картами ITU-R P.2001-6")
    ap.add_argument("--output", default=default_out, help="путь результата P2001.npz")
    args = ap.parse_args()

    maps: dict[str, "np.ndarray"] = {}
    failed = False
    for name in REQUIRED:
        path = os.path.join(args.maps_dir, name)
        try:
            # TropoClim — целочисленная сетка климатических зон (Annex E);
            # FoEs0.1.txt → ключ FoEs0p1 (как в оригинальном initiate_digital_maps.py)
            matrix = np.loadtxt(path, dtype=int) if name == "TropoClim.txt" else np.loadtxt(path)
            key = name[:-4]
            if key == "FoEs0.1":
                key = "FoEs0p1"
            maps[key] = matrix
            print(f"OK: {name} — {matrix.shape}")
        except OSError as e:
            print(f"ОШИБКА: {name} не найден в {args.maps_dir} ({e})")
            failed = True
        except ValueError as e:
            print(f"ОШИБКА: {name} содержит нечисловые данные ({e})")
            failed = True

    if failed or not maps:
        print("\nСборка не выполнена. Скачайте карты ITU-R P.2001-6 (14 .txt из ZIP-E) —")
        print("см. scripts/download_p2001_maps.ps1 или README, раздел «Полная P.2001-6».")
        return 1

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    np.savez_compressed(args.output, **maps)
    print(f"P2001.npz создан: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
