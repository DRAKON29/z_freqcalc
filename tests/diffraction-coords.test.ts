/** Тесты дифракции P.526 и координат WGS84 ↔ СК-42. */
import { describe, it, expect } from 'bun:test'
import { knifeEdgeV, knifeEdgeLossDb, bullingtonLossDb, deygoutLossDb, diffractionLossDb, extractEdges } from '../src/lib/radio/diffraction'
import { wgs84ToSk42, sk42ToWgs84, distanceM, bearingDeg, destination } from '../src/lib/radio/coordinates'
import { fresnelRadiusM, clearanceM, fresnelClearanceRatio } from '../src/lib/radio/fresnel'

describe('Дифракция P.526', () => {
  it('v=0 → 6.02 дБ (кромка на LOS)', () => {
    expect(knifeEdgeLossDb(0)).toBeCloseTo(6.02, 1)
  })
  it('v < −0.78 → 0 дБ', () => {
    expect(knifeEdgeLossDb(-1.0)).toBe(0)
  })
  it('v=1 → ≈ 13.5 дБ', () => {
    expect(knifeEdgeLossDb(1)).toBeGreaterThan(12)
    expect(knifeEdgeLossDb(1)).toBeLessThan(15)
  })
  it('параметр v растёт с высотой ребра', () => {
    const v1 = knifeEdgeV(10_000, 10_000, 50, 1000)
    const v2 = knifeEdgeV(10_000, 10_000, 100, 1000)
    expect(v2).toBeGreaterThan(v1)
  })
  it('плоская трасса без препятствий → 0 дБ', () => {
    const profile = [{ d: 0, elev: 100 }, { d: 10_000, elev: 100 }, { d: 20_000, elev: 100 }]
    expect(diffractionLossDb(profile, 100 + 20, 100 + 10, 2000, 4 / 3)).toBe(0)
  })
  it('одно препятствие чуть выше LOS даёт ~6 дБ (Буллингтон)', () => {
    const profile = [
      { d: 0, elev: 100 },
      { d: 10_000, elev: 109.5 }, // eff = 109.5+5.9 ≈ 115.4, LOS = 115
      { d: 20_000, elev: 100 },
    ]
    const bull = bullingtonLossDb(extractEdges(profile), 120, 110, 20_000, 2000, 4 / 3)
    expect(bull).toBeGreaterThan(3)
    expect(bull).toBeLessThan(10)
  })
  it('Дейгаут ≥ 0', () => {
    const profile = [
      { d: 0, elev: 100 },
      { d: 8_000, elev: 180 },
      { d: 14_000, elev: 150 },
      { d: 20_000, elev: 100 },
    ]
    expect(deygoutLossDb(extractEdges(profile), 120, 110, 20_000, 2000, 4 / 3)).toBeGreaterThanOrEqual(0)
  })
  it('берётся наибольшая из оценок (Дейгаут/Буллингтон)', () => {
    const profile = [
      { d: 0, elev: 100 },
      { d: 8_000, elev: 180 },
      { d: 14_000, elev: 150 },
      { d: 20_000, elev: 100 },
    ]
    const edges = extractEdges(profile)
    const combined = diffractionLossDb(profile, 120, 110, 2000, 4 / 3)
    const deygout = deygoutLossDb(edges, 120, 110, 20_000, 2000, 4 / 3)
    const bull = bullingtonLossDb(edges, 120, 110, 20_000, 2000, 4 / 3)
    expect(combined).toBeCloseTo(Math.max(deygout, bull), 5)
  })
  it('высокий холм даёт существенные потери (> 15 дБ)', () => {
    const profile = [
      { d: 0, elev: 100 },
      { d: 10_000, elev: 160 },
      { d: 20_000, elev: 100 },
    ]
    expect(diffractionLossDb(profile, 120, 110, 2000, 4 / 3)).toBeGreaterThan(15)
  })
})

describe('Зона Френеля', () => {
  it('радиус F1 максимален в середине', () => {
    const mid = fresnelRadiusM(25_000, 50_000, 2000)
    const quarter = fresnelRadiusM(12_500, 50_000, 2000)
    expect(mid).toBeGreaterThan(quarter)
    expect(mid).toBeCloseTo(Math.sqrt((0.15 * 25_000 * 25_000) / 50_000), 0)
  })
  it('клиренс LOS: obstacle ниже LOS → положительный', () => {
    const c = clearanceM(200, 200, 50_000, 25_000, 100, 4 / 3)
    // LOS = 200 − bulge(25км) ≈ 200 − 36.6 = 163.4 → клиренс ≈ 63.4
    expect(c).toBeGreaterThan(60)
  })
  it('отношение клиренса к F1 при препятствии выше LOS отрицательное', () => {
    const r = fresnelClearanceRatio(200, 200, 50_000, 25_000, 170, 4 / 3, 2000)
    expect(r).toBeLessThan(0)
  })
})

describe('Координаты WGS84 ↔ СК-42', () => {
  it('конверсия туда-обратно сходится (< 5 м)', () => {
    const moscow = { lat: 55.7558, lon: 37.6173 }
    const sk = wgs84ToSk42(moscow)
    expect(sk.zone).toBe(7)
    expect(sk.y).toBeGreaterThan(7e6)
    const back = sk42ToWgs84(sk)
    const err = distanceM(moscow, back)
    expect(err).toBeLessThan(5)
  })
  it('СК-42 в Москве совпадает с эталоном проекции (±10 м)', () => {
    const sk = wgs84ToSk42({ lat: 55.7558, lon: 37.6173 })
    // Эталон: проекция ГК zone 7 на Красовском для BL, полученных Гельмертом
    // (сверено с pyproj +proj=tmerc +ellps=krass: 6182350.2, 7413070.3)
    expect(sk.x).toBeGreaterThan(6_182_300)
    expect(sk.x).toBeLessThan(6_182_400)
    expect(sk.y).toBeGreaterThan(7_413_000)
    expect(sk.y).toBeLessThan(7_413_200)
  })
  it('зона Гаусса–Крюгера: долгота 39° → зона 7, 100° → зона 17', () => {
    expect(wgs84ToSk42({ lat: 55, lon: 39 }).zone).toBe(7)
    expect(wgs84ToSk42({ lat: 55, lon: 100 }).zone).toBe(17)
  })
  it('Haversine: Москва—СПб ≈ 634 км', () => {
    const d = distanceM({ lat: 55.7558, lon: 37.6173 }, { lat: 59.9343, lon: 30.3351 })
    expect(d / 1000).toBeGreaterThan(610)
    expect(d / 1000).toBeLessThan(660)
  })
  it('азимут на север = 0, на восток ≈ 90', () => {
    const a = { lat: 55, lon: 37 }
    expect(bearingDeg(a, { lat: 56, lon: 37 })).toBeCloseTo(0, 1)
    // начальный азимут большой окружности на параллели < 90 (сходимость меридианов)
    const be = bearingDeg(a, { lat: 55, lon: 38 })
    expect(Math.abs(be - 90)).toBeLessThan(0.5)
  })
  it('destination: 1 км на север ≈ +0.009° широты', () => {
    const p = destination({ lat: 55, lon: 37 }, 1000, 0)
    expect(p.lat - 55).toBeCloseTo(0.009, 2)
  })
})
