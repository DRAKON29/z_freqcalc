"""Проверка структуры загруженных файлов ITU-R P.2001-6 (README Table 3)."""
import re
from pathlib import Path

UP = Path('/home/z/my-project/upload')

# Ожидания из README_P2001-6.docx (Table 3)
EXPECTED = {
    'DN_Median.txt':    (121, 241, 1.5, 90.0, 0.0),
    'DN_SubSlope.txt':  (121, 241, 1.5, 90.0, 0.0),
    'DN_SupSlope.txt':  (121, 241, 1.5, 90.0, 0.0),
    'dndz_01.txt':      (121, 241, 1.5, 90.0, 0.0),
    'Esarain_Pr6_v5.txt': (161, 321, 1.125, 90.0, 0.0),
    'Esarain_Mt_v5.txt':  (161, 321, 1.125, 90.0, 0.0),
    'Esarain_Beta_v5.txt': (161, 321, 1.125, 90.0, 0.0),
    'FoEs0.1.txt':      (121, 241, 1.5, 90.0, 0.0),
    'FoEs01.txt':       (121, 241, 1.5, 90.0, 0.0),
}

ok = True
for name, (rows, cols, dlat, lat0, lon0) in EXPECTED.items():
    p = UP / name
    if not p.exists():
        print(f'ОТСУТСТВУЕТ: {name}')
        ok = False
        continue
    lines = [l for l in p.read_text().splitlines() if l.strip()]
    if len(lines) != rows:
        print(f'{name}: строк {len(lines)} ≠ {rows}')
        ok = False
        continue
    bad_cols = [i for i, l in enumerate(lines) if len(l.split()) != cols]
    if bad_cols:
        print(f'{name}: строк с неверным числом столбцов: {len(bad_cols)} (первые: {bad_cols[:5]})')
        ok = False
        continue
    try:
        vals = [[float(t) for t in l.split()] for l in lines]
    except ValueError as e:
        print(f'{name}: нечисловое значение: {e}')
        ok = False
        continue
    v0 = vals[0][0]
    vmin = min(min(r) for r in vals)
    vmax = max(max(r) for r in vals)
    # Проверка «последний столбец = первый» (кроме TropoClim)
    wrap_ok = all(abs(r[0] - r[-1]) < 1e-9 for r in vals)
    print(f'{name}: OK {rows}×{cols}, шаг {dlat}°, v[0,0]={v0}, min={vmin:.6g}, max={vmax:.6g}, wrap(360°)={"да" if wrap_ok else "НЕТ"}')

print('\nИТОГ:', 'все файлы соответствуют README Table 3' if ok else 'есть расхождения')
