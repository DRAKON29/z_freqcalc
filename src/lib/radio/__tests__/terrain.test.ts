/**
 * Тесты рельефа: парсер SRTM .hgt, синтетический DEM, покрытие тайлов,
 * профиль трассы, clutter GeoJSON (здания/растительность), валидация.
 */
import { describe, it, expect } from 'vitest'
import {
  parseHgt,
  tileElevation,
  createHgtDem,
  createSyntheticDem,
  tileBounds,
  pointInTiles,
  pathTileCoverage,
  buildProfile,
  makeClutterSampler,
  validateClutter,
  type HgtTile,
  type ClutterGeoJson,
} from '../terrain'
import { makeHgtBuffer, makeTile } from './terrain-helpers'
import { distanceM } from '../coordinates'

describe('parseHgt: разбор .hgt', () => {
  it('имя N47E039 → лат/лон угла, сетка 1201×1201', () => {
    const t = makeTile()
    expect(t.name).toBe('N47E039')
    expect(t.latOrigin).toBe(47)
    expect(t.lonOrigin).toBe(39)
    expect(t.size).toBe(1201)
    expect(t.stepDeg).toBeCloseTo(3 / 3600, 8)
  })
  it('южное полушарие: S10W020 → отрицательные углы', () => {
    const t = parseHgt(makeHgtBuffer(1201, () => 5), 'S10W020.hgt')
    expect(t.latOrigin).toBe(-10)
    expect(t.lonOrigin).toBe(-20)
  })
  it('3-секундный vs 1-секундный (3601×3601)', () => {
    const t = parseHgt(makeHgtBuffer(3601, () => 1), 'N47E039.hgt')
    expect(t.stepDeg).toBeCloseTo(1 / 3600, 8)
  })
  it('неверное имя файла → понятная ошибка', () => {
    expect(() => parseHgt(makeHgtBuffer(1201, () => 0), 'foo.hgt')).toThrow(/NXXEXXX/)
  })
  it('неверный размер сетки → ошибка', () => {
    const buf = new ArrayBuffer(1000 * 1000 * 2)
    expect(() => parseHgt(buf, 'N47E039.hgt')).toThrow(/размер/i)
  })
  it('размер файла не соответствует сетке → ошибка', () => {
    const buf = new ArrayBuffer(1201 * 1201 * 2 + 5)
    expect(() => parseHgt(buf, 'N47E039.hgt')).toThrow(/Б не соответствует/)
  })
})

describe('tileElevation: билинейная интерполяция', () => {
  it('высота в узле сетки совпадает с данными', () => {
    const t = makeTile()
    // узел (0,0) — начало координат (ЮЗ угол)
    expect(tileElevation(t, 47, 39)).toBe(100)
  })
  it('в центре тайла — интерполированное значение между узлами', () => {
    const t = makeTile()
    const mid = tileElevation(t, 47.5, 39.5)
    // функция высоты 100 + r − c линейна → в центре ≈ 100
    expect(mid).toBeCloseTo(100, 0)
  })
  it('высота растёт на север (r → lat)', () => {
    const t = makeTile()
    expect(tileElevation(t, 47.9, 39)).toBeGreaterThan(tileElevation(t, 47.1, 39))
  })
  it('за пределами сетки — клампа к краю (без NaN)', () => {
    const t = makeTile()
    expect(Number.isFinite(tileElevation(t, 47.9999999, 39.9999999))).toBe(true)
    expect(Number.isFinite(tileElevation(t, 48, 40))).toBe(true)
  })
})

describe('createHgtDem: DEM из набора тайлов', () => {
  it('находит тайл по имени из координат', () => {
    const dem = createHgtDem([makeTile()])
    expect(dem.elevationAt(47.5, 39.5)).toBeCloseTo(100, 0)
  })
  it('вне тайлов → 0 м (сигнал для предупреждения о покрытии)', () => {
    const dem = createHgtDem([makeTile()])
    expect(dem.elevationAt(10, 10)).toBe(0)
  })
  it('имя источника содержит количество тайлов', () => {
    expect(createHgtDem([makeTile()]).name).toContain('1')
  })
  it('пустой список тайлов не падает', () => {
    const dem = createHgtDem([])
    expect(dem.resolutionM).toBe(30)
  })
})

describe('createSyntheticDem: детерминированный demo-рельеф', () => {
  it('одна точка возвращает одно и то же значение (детерминизм)', () => {
    const dem = createSyntheticDem()
    const a = dem.elevationAt(55.75, 37.61)
    const b = createSyntheticDem().elevationAt(55.75, 37.61)
    expect(a).toBe(b)
  })
  it('высоты в разумном диапазоне 0…400 м', () => {
    const dem = createSyntheticDem()
    for (const [lat, lon] of [[55, 37], [56, 38], [45, 40]] as const) {
      const h = dem.elevationAt(lat, lon)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(400)
    }
  })
})

describe('Границы тайлов и покрытие', () => {
  const tile = makeTile()

  it('tileBounds: [47..48]×[39..40] для N47E039', () => {
    const b = tileBounds(tile)
    expect(b).toEqual({ minLat: 47, maxLat: 48, minLon: 39, maxLon: 40 })
  })
  it('pointInTiles: точка внутри — да, снаружи — нет', () => {
    expect(pointInTiles(47.5, 39.5, [tile])).toBe(true)
    expect(pointInTiles(48.5, 39.5, [tile])).toBe(false)
    expect(pointInTiles(47.5, 40.5, [tile])).toBe(false)
  })
  it('граничные значения входят в покрытие (≤)', () => {
    expect(pointInTiles(47, 39, [tile])).toBe(true)
    expect(pointInTiles(48, 40, [tile])).toBe(true)
  })

  it('pathTileCoverage: трасса целиком внутри → outside=false', () => {
    const a = { lat: 47.1, lon: 39.1 }
    const b = { lat: 47.9, lon: 39.9 }
    const profile = [{ d: 0 }, { d: 1 }, { d: 2 }] as never
    const cov = pathTileCoverage(profile, [a, b], [tile])
    expect(cov.outside).toBe(false)
    expect(cov.insideRatio).toBe(1)
  })
  it('pathTileCoverage: трасса целиком снаружи → outside=true, ratio 0', () => {
    const a = { lat: 10.1, lon: 10.1 }
    const b = { lat: 10.9, lon: 10.9 }
    const cov = pathTileCoverage([{ d: 0 }] as never, [a, b], [tile])
    expect(cov.outside).toBe(true)
    expect(cov.insideRatio).toBe(0)
  })
  it('пустой список тайлов → покрытие считается полным (demo-режим)', () => {
    const cov = pathTileCoverage([{ d: 0 }] as never, [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], [])
    expect(cov.outside).toBe(false)
  })
})

describe('buildProfile: профиль трассы', () => {
  it('концы профиля совпадают с точками A и Б', () => {
    const dem = createSyntheticDem()
    const a = { lat: 55.7558, lon: 37.6173 }
    const b = { lat: 55.8305, lon: 37.8501 }
    const p = buildProfile(a, b, dem)
    expect(p.length).toBeGreaterThanOrEqual(20)
    expect(p[0].d).toBe(0)
    expect(p[p.length - 1].d).toBeCloseTo(distanceM(a, b), 0)
  })
  it('расстояния монотонно не убывают', () => {
    const dem = createSyntheticDem()
    const p = buildProfile({ lat: 55, lon: 37 }, { lat: 55.5, lon: 38 }, dem)
    for (let i = 1; i < p.length; i++) expect(p[i].d).toBeGreaterThanOrEqual(p[i - 1].d)
  })
  it('clutter из сэмплера попадает в total = elev + clutter', () => {
    const dem = createSyntheticDem()
    const p = buildProfile({ lat: 55, lon: 37 }, { lat: 55.1, lon: 37.1 }, dem, () => ({ type: 'building', height: 25 }))
    expect(p[5].clutter).toBe(25)
    expect(p[5].total).toBe(p[5].elev + 25)
  })
})

describe('makeClutterSampler: выборка зданий/растительности', () => {
  const gj: ClutterGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[37.6, 55.7], [37.62, 55.7], [37.62, 55.72], [37.6, 55.72], [37.6, 55.7]]],
        },
        properties: { type: 'building', height: 30 },
      },
    ],
  }
  const sampler = makeClutterSampler(gj)

  it('точка внутри полигона → тип и высота', () => {
    expect(sampler(55.71, 37.61)).toEqual({ type: 'building', height: 30 })
  })
  it('точка снаружи → null', () => {
    expect(sampler(55.9, 37.9)).toBeNull()
  })
  it('MultiPolygon поддерживается', () => {
    const multi: ClutterGeoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[37.0, 50.0], [37.01, 50.0], [37.01, 50.01], [37.0, 50.01], [37.0, 50.0]]]],
          },
          properties: { type: 'vegetation', height: 12 },
        },
      ],
    }
    expect(makeClutterSampler(multi)(50.005, 37.005)).toEqual({ type: 'vegetation', height: 12 })
  })
  it('пустая FeatureCollection → всегда null', () => {
    expect(makeClutterSampler({ type: 'FeatureCollection', features: [] })(0, 0)).toBeNull()
  })
})

describe('validateClutter: валидация GeoJSON', () => {
  it('валидный файл → ok, количество объектов', () => {
    const gj = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { type: 'building', height: 12 },
        },
      ],
    }
    const v = validateClutter(gj)
    expect(v.ok).toBe(true)
    expect(v.count).toBe(1)
  })
  it('не FeatureCollection → ошибка', () => {
    expect(validateClutter({ type: 'Feature' }).ok).toBe(false)
    expect(validateClutter(null).ok).toBe(false)
  })
  it('неверная геометрия (Point) → ошибка', () => {
    const gj = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }],
    }
    expect(validateClutter(gj).ok).toBe(false)
  })
  it('недопустимый type → ошибка', () => {
    const gj = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { type: 'road' },
        },
      ],
    }
    const v = validateClutter(gj)
    expect(v.ok).toBe(false)
    expect(v.error).toContain('road')
  })
  it('height не число → ошибка', () => {
    const gj = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { height: 'высокий' },
        },
      ],
    }
    expect(validateClutter(gj).ok).toBe(false)
  })
})
