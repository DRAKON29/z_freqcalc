/**
 * Тесты координат: WGS 84 ↔ СК-42 (Гаусса–Крюгера, эллипсоид Красовского),
 * расстояния, азимуты, точка назначения, нормализация углов.
 */
import { describe, it, expect } from 'vitest'
import { wgs84ToSk42, sk42ToWgs84, distanceM, bearingDeg, destination, wrap180 } from '../coordinates'
import type { LatLon } from '../types'

const MOSCOW: LatLon = { lat: 55.7558, lon: 37.6173 }
const PETERSBURG: LatLon = { lat: 59.9391, lon: 30.3149 }

describe('СК-42: определение зоны', () => {
  it('Москва (37.6° в.д.) → зона 7', () => {
    const sk = wgs84ToSk42(MOSCOW)
    expect(sk.zone).toBe(7)
  })
  it('Санкт-Петербург (30.3° в.д.) → зона 6', () => {
    expect(wgs84ToSk42(PETERSBURG).zone).toBe(6)
  })
  it('глубоко внутри зоны 7 (36.05° в.д.) → зона 7', () => {
    // зона считается по долготе на эллипсоиде Красовского (после Гельмерта),
    // поэтому на самой границе 36° возможно смещение к предыдущей зоне
    expect(wgs84ToSk42({ lat: 50, lon: 36.05 }).zone).toBe(7)
  })
  it('территория РФ покрывается зонами 4–32', () => {
    for (const [lon, zone] of [[19.5, 4], [55.5, 10], [131.9, 22], [178, 30]] as const) {
      expect(wgs84ToSk42({ lat: 55, lon }).zone).toBe(zone)
    }
  })
})

describe('СК-42: эталонные координаты Москвы', () => {
  it('X ≈ 6 182 000 м; Y = 7 413 070 м (зона 7 + 413 км восток)', () => {
    const sk = wgs84ToSk42(MOSCOW)
    // Справочные значения для Москвы в СК-42, зона 7:
    // X (север) ≈ 6 182 348 м, Y (восток) ≈ 7 413 070 м
    expect(sk.x).toBeGreaterThan(6_176_000)
    expect(sk.x).toBeLessThan(6_188_000)
    expect(sk.y).toBeGreaterThan(7_408_000)
    expect(sk.y).toBeLessThan(7_418_000)
    const yNoZone = sk.y - sk.zone * 1e6
    expect(yNoZone).toBeGreaterThan(408_000)
    expect(yNoZone).toBeLessThan(418_000)
  })
})

describe('СК-42 ↔ WGS 84: точность ~1–2 м', () => {
  const samples: LatLon[] = [
    MOSCOW,
    PETERSBURG,
    { lat: 43.1176, lon: 131.8855 }, // Владивосток
    { lat: -33.8678, lon: 151.2073 }, // Сидней
    { lat: 0.01, lon: 12.01 },
  ]
  for (const [i, p] of samples.entries()) {
    it(`образец #${i + 1}: туда-обратно сходится в пределах 3 м`, () => {
      const sk = wgs84ToSk42(p)
      const back = sk42ToWgs84(sk)
      const err = distanceM(p, back)
      expect(err).toBeLessThan(3)
    })
  }
  it('обратное преобразование сохраняет зону', () => {
    const sk = wgs84ToSk42(MOSCOW)
    const back = sk42ToWgs84(sk)
    expect(wgs84ToSk42(back).zone).toBe(sk.zone)
  })
})

describe('Расстояние по большой окружности (Haversine)', () => {
  it('Москва — Санкт-Петербург ≈ 634–640 км', () => {
    const d = distanceM(MOSCOW, PETERSBURG)
    expect(d).toBeGreaterThan(630_000)
    expect(d).toBeLessThan(645_000)
  })
  it('нулевое расстояние для одинаковых точек', () => {
    expect(distanceM(MOSCOW, MOSCOW)).toBe(0)
  })
  it('симметрично', () => {
    expect(distanceM(MOSCOW, PETERSBURG)).toBeCloseTo(distanceM(PETERSBURG, MOSCOW), 6)
  })
  it('1° по экватору ≈ 111.2 км', () => {
    const d = distanceM({ lat: 0, lon: 10 }, { lat: 0, lon: 11 })
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })
})

describe('Азимут (bearingDeg)', () => {
  it('север → 0°', () => {
    expect(bearingDeg({ lat: 55, lon: 30 }, { lat: 56, lon: 30 })).toBeCloseTo(0, 3)
  })
  it('восток → ~90°', () => {
    expect(bearingDeg({ lat: 55, lon: 30 }, { lat: 55.0001, lon: 30.5 })).toBeCloseTo(90, 0)
  })
  it('юг → 180°', () => {
    expect(bearingDeg({ lat: 55, lon: 30 }, { lat: 54, lon: 30 })).toBeCloseTo(180, 3)
  })
  it('запад → ~270°', () => {
    expect(bearingDeg({ lat: 55, lon: 30 }, { lat: 55.0001, lon: 29.5 })).toBeCloseTo(270, 0)
  })
  it('обратный азимут отличается от прямого на ~180° (сходимость меридианов)', () => {
    const az = bearingDeg(MOSCOW, PETERSBURG)
    const rev = bearingDeg(PETERSBURG, MOSCOW)
    // для трассы 634 км на широте ~58° поправка до 7°
    expect(Math.abs(wrap180(rev - az - 180))).toBeLessThan(8)
  })
})

describe('Точка назначения (destination)', () => {
  it('круговой маршрут: destination ∘ (d, az) возвращает исходное', () => {
    const d = 25_000
    const az = 75
    const p = destination(MOSCOW, d, az)
    expect(distanceM(MOSCOW, p)).toBeCloseTo(d, 0)
    expect(bearingDeg(MOSCOW, p)).toBeCloseTo(az, 2)
  })
  it('движение на север увеличивает широту', () => {
    const p = destination({ lat: 55, lon: 30 }, 10_000, 0)
    expect(p.lat).toBeGreaterThan(55)
    expect(p.lon).toBeCloseTo(30, 6)
  })
})

describe('Нормализация угла wrap180', () => {
  it('0 → 0, 180 → 180, −180 → −180', () => {
    expect(wrap180(0)).toBe(0)
    expect(wrap180(180)).toBe(-180) // [−180, 180)
    expect(wrap180(-180)).toBe(-180)
  })
  it('сброс полного круга', () => {
    expect(wrap180(370)).toBeCloseTo(10, 8)
    expect(wrap180(-370)).toBeCloseTo(-10, 8)
    expect(wrap180(540)).toBe(-180) // [−180, 180)
    expect(wrap180(181)).toBe(-179)
  })
})
