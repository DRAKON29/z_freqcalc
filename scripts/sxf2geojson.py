# -*- coding: utf-8 -*-
"""
Офлайн-конвертация SXF + RSC → clutter.geojson (ТЗ 4.6, 5.3) через GDAL/OGR.

Использование:
    python3 sxf2geojson.py input.sxf -o clutter.geojson
    SXF_RSC_FILENAME=my.rsc python3 sxf2geojson.py input.sxf -o clutter.geojson

Требования:
    • GDAL/OGR с драйвером SXF (gdal >= 3.x, сборка с поддержкой SXF);
    • файл классификатора .rsc с тем же базовым именем, что и .sxf
      (или заданный через переменную окружения SXF_RSC_FILENAME / флаг --rsc).

Результат: GeoJSON FeatureCollection, поля:
    type   — 'building' | 'vegetation' (по кодам классификатора);
    height — высота объекта, м (здания — из атрибута/классификатора,
             растительность — типовая по коду);
    name   — название объекта из классификатора RSC.

Интеграция аддитивная (ТЗ 9.3): существующие контракты profile/dem/budget
не изменяются — geojson подключается как источник heights в профиле.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    from osgeo import ogr, osr
except ImportError:
    sys.exit(
        "Не найден модуль osgeo (GDAL/OGR). Установите: apt-get install python3-gdal\n"
        "или pip install gdal (с системными библиотеками GDAL >= 3.4, драйвер SXF)."
    )

# Коды классификатора «Панорама» (упрощённая группа):
# слой/код → тип clutter и типовая высота, м.
# Полные коды зависят от версии .rsc — настраивается через RSC-классификатор.
DEFAULT_CODE_MAP = {
    7: ("building", 12),        # кварталы многоэтажной застройки
    8: ("building", 9),         # одно-двухэтажная застройка
    9: ("building", 20),        # высотная застройка
    10: ("building", 6),        # сельская застройка
    11: ("building", 15),       # промышленные здания
    20: ("vegetation", 15),     # лес хвойный
    21: ("vegetation", 12),     # лес лиственный
    22: ("vegetation", 10),     # смешанный лес
    23: ("vegetation", 4),      # кустарник
    24: ("vegetation", 1.5),    # травяная растительность / поля
}


def read_rsc_names(rsc_path: Path) -> dict[int, str]:
    """Чтение имён объектов из классификатора RSC (секция Object)."""
    names: dict[int, str] = {}
    try:
        text = rsc_path.read_text(encoding="cp1251", errors="replace")
    except OSError as e:
        print(f"  ! RSC недоступен: {e}", file=sys.stderr)
        return names
    in_objects = False
    current_code = None
    for line in text.splitlines():
        s = line.strip()
        if s.upper().startswith("OBJECT"):
            in_objects = True
            continue
        if in_objects and s.upper().startswith("END"):
            in_objects = False
            continue
        if in_objects:
            if s.upper().startswith("CODE"):
                try:
                    current_code = int(s.split("=")[1].strip())
                except (IndexError, ValueError):
                    current_code = None
            elif s.upper().startswith("NAME") and current_code is not None:
                names[current_code] = s.split("=", 1)[1].strip()
    return names


def convert(sxf_path: Path, rsc_path: Path | None, out_path: Path, code_map: dict[int, tuple[str, float]]) -> int:
    ds = ogr.Open(str(sxf_path))
    if ds is None:
        sys.exit(f"GDAL не смог открыть {sxf_path} (проверьте сборку GDAL с драйвером SXF)")

    rsc_names = read_rsc_names(rsc_path) if rsc_path else {}

    features = []
    src_srs: osr.SpatialReference | None = None

    for layer_idx in range(ds.GetLayerCount()):
        layer = ds.GetLayerByIndex(layer_idx)
        if layer is None:
            continue
        srs = layer.GetSpatialRef()
        if srs and src_srs is None:
            src_srs = srs
        # координаты SXF в метрах СК-42 (Гаусс–Крюгер); преобразуем в WGS 84
        transform = None
        if srs:
            target = osr.SpatialReference()
            target.ImportFromEPSG(4326)
            try:
                target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                transform = osr.CoordinateTransformation(srs, target)
            except Exception:
                transform = None

        code = layer.GetFIDColumn() or ""
        layer_defn = layer.GetLayerDefn()
        # ищем поле-высоту
        height_field = None
        for i in range(layer_defn.GetFieldCount()):
            fname = layer_defn.GetFieldDefn(i).GetName().upper()
            if fname in ("HEIGHT", "H", "VYSOTA", "ВЫСОТА"):
                height_field = i
                break

        for feat in layer:
            geom = feat.GetGeometryRef()
            if geom is None:
                continue
            layer_code = layer.GetFeatureCount() and layer_idx  # код слоя как fallback
            key = None
            # код объекта: атрибут CODE/KEY, иначе — код слоя
            for i in range(layer_defn.GetFieldCount()):
                fname = layer_defn.GetFieldDefn(i).GetName().upper()
                if fname in ("CODE", "KEY", "IMPCODE"):
                    try:
                        key = int(feat.GetField(i))
                    except (TypeError, ValueError):
                        key = None
                    break
            if key is None:
                key = layer_idx + 7

            if key in code_map:
                ctype, height = code_map[key]
            else:
                ctype, height = "building", 10.0

            if height_field is not None:
                try:
                    h = float(feat.GetField(height_field))
                    if h > 0:
                        height = h
                except (TypeError, ValueError):
                    pass

            g = geom.Clone()
            if transform:
                try:
                    g.Transform(transform)
                except Exception:
                    pass

            geojson_geom = json.loads(g.ExportToJson())
            properties = {
                "type": ctype,
                "height": height,
                "name": rsc_names.get(key, f"слой {layer_idx}, код {key}"),
            }
            features.append({"type": "Feature", "geometry": geojson_geom, "properties": properties})

    fc = {"type": "FeatureCollection", "features": features}
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    return len(features)


def main() -> None:
    ap = argparse.ArgumentParser(description="SXF + RSC → clutter.geojson (GDAL/OGR, офлайн)")
    ap.add_argument("sxf", help="входной файл .sxf")
    ap.add_argument("-o", "--out", default="clutter.geojson", help="выходной .geojson")
    ap.add_argument("--rsc", default=None, help="классификатор .rsc (по умолчанию — рядом с .sxf или SXF_RSC_FILENAME)")
    args = ap.parse_args()

    sxf_path = Path(args.sxf)
    if not sxf_path.exists():
        sys.exit(f"Файл не найден: {sxf_path}")

    rsc_env = os.environ.get("SXF_RSC_FILENAME")
    rsc_path = None
    if args.rsc:
        rsc_path = Path(args.rsc)
    elif rsc_env:
        rsc_path = sxf_path.parent / rsc_env
    else:
        candidate = sxf_path.with_suffix(".rsc")
        if candidate.exists():
            rsc_path = candidate
    # ТЗ 5.3: имена .sxf и .rsc должны совпадать (или задаваться SXF_RSC_FILENAME)
    if rsc_path and rsc_path.stem != sxf_path.stem and not rsc_env and not args.rsc:
        print(f"  ! Имена .sxf ({sxf_path.stem}) и .rsc ({rsc_path.stem}) не совпадают — проверьте классификатор", file=sys.stderr)

    if rsc_path and not rsc_path.exists():
        print(f"  ! RSC не найден: {rsc_path} — используются типовые коды", file=sys.stderr)
        rsc_path = None

    n = convert(sxf_path, rsc_path, Path(args.out), DEFAULT_CODE_MAP)
    print(f"Готово: {args.out} — {n} объектов (type: building/vegetation, height)")


if __name__ == "__main__":
    main()
