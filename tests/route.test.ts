/** Тесты маршрута из файла траектории (расширение любое, структура строго по образцу). */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRouteFile, routeDurationS, routeStateAt } from '../src/lib/radio/route'
import { simulateDynamics } from '../src/lib/radio/doppler'
import { destination } from '../src/lib/radio/coordinates'
import type { CalculationInput, DynamicParams, RouteData } from '../src/lib/radio/types'

const sampleText = readFileSync(join(import.meta.dir, 'fixtures', 'route-sample.rt'), 'utf-8')

const opts = {
  powerDbm: 30,
  txGainDbi: 10,
  rxGainDbi: 3,
  sensitivityDbm: -100,
  noiseBandwidthHz: 1e6,
  noiseFigureDb: 3,
  modulation: 'QPSK' as const,
}

const A = { lat: 55.7558, lon: 37.6173 }
const B = { lat: 55.7558, lon: 37.7625 } // 10 км на восток

const makeInput = (): CalculationInput => ({
  frequencyMhz: 2400,
  polarization: 'vertical',
  path: {
    points: [A, B],
    distanceM: 10000,
    azimuthDeg: 90,
    profile: [
      { d: 0, elev: 0, clutter: 0, total: 0 },
      { d: 0.5, elev: 0, clutter: 0, total: 0 },
      { d: 1, elev: 0, clutter: 0, total: 0 },
    ],
    demStepM: 30,
    demSource: 'test',
  },
  txHeightM: 30,
  rxHeightM: 10,
  timePercents: [50],
  kFactor: 4 / 3,
  atmosphere: { rainRateMmH: 0, gases: false, vegetation: false },
  epsilon: 15,
  sigma: 0.005,
  climateZone: 'K',
})

const makeParams = (over: Partial<DynamicParams> = {}): DynamicParams => ({
  altitudeM: 500,
  speedKmh: 150,
  initialElevationDeg: 90,
  initialAzimuthDeg: 90,
  trajectoryAzimuthDeg: 90,
  durationS: 360,
  ...over,
})

/** Маршрут из 4 коллинеарных точек на восток от A: 0 / 5 / 10 / 15 км, 150 км/ч, 500 м. */
function straightRoute(): RouteData {
  return {
    name: 'straight',
    tripodHeightM: 4,
    points: [0, 5000, 10000, 15000].map((d) => {
      const p = destination(A, d, 90)
      return { lat: p.lat, lon: p.lon, altitudeM: 500, speedKmh: 150 }
    }),
  }
}

describe('Разбор файла траектории', () => {
  it('образец пз1.rt: 4 точки, высота штатива 4 м', () => {
    const res = parseRouteFile(sampleText, 'пз1.rt')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.points.length).toBe(4)
    expect(res.data.tripodHeightM).toBe(4)
    expect(res.data.name).toBe('пз1.rt')
    expect(res.data.points[0].altitudeM).toBe(204)
    expect(res.data.points[0].speedKmh).toBe(120)
    expect(res.data.points[3].speedKmh).toBe(130)
  })

  it('расширение файла не влияет на разбор (структура важнее расширения)', () => {
    const res = parseRouteFile(sampleText, 'маршрут.txt')
    expect(res.ok).toBe(true)
  })

  it('длительность образца — около 17–18 минут', () => {
    const res = parseRouteFile(sampleText)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const t = routeDurationS(res.data)
    expect(t).toBeGreaterThan(1000)
    expect(t).toBeLessThan(1100)
  })

  it('ошибки: не-JSON, нет route, мало точек, скорость ≤ 0, плохие координаты', () => {
    expect(parseRouteFile('not json').ok).toBe(false)
    expect(parseRouteFile('{}').ok).toBe(false)
    const three = { route: { points: [1, 2, 3].map((i) => ({ lat: 50 + i * 0.01, lon: 36, altitude: 500, speed: 150 })) }, tripodHeight: 4 }
    const r3 = parseRouteFile(JSON.stringify(three))
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error).toContain('минимум 4 точки')
    const zero = { route: { points: [1, 2, 3, 4].map((i) => ({ lat: 50 + i * 0.01, lon: 36, altitude: 500, speed: 0 })) }, tripodHeight: 4 }
    expect(parseRouteFile(JSON.stringify(zero)).ok).toBe(false)
    const bad = { route: { points: [1, 2, 3, 4].map((i) => ({ lat: 95, lon: 36, altitude: 500, speed: 150 })) }, tripodHeight: 4 }
    expect(parseRouteFile(JSON.stringify(bad)).ok).toBe(false)
  })

  it('маршрут дольше часа отклоняется с понятной ошибкой', () => {
    // 4 точки по 0.1° широты (~11 км) при 10 км/ч → ~3.3 часа
    const slow = {
      route: { points: [0, 1, 2, 3].map((i) => ({ lat: 50 + i * 0.1, lon: 36, altitude: 500, speed: 10 })) },
      tripodHeight: 4,
    }
    const res = parseRouteFile(JSON.stringify(slow))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('превышает 1 час')
  })
})

describe('Состояние на маршруте (routeStateAt)', () => {
  const res = parseRouteFile(sampleText)
  const route = res.ok ? res.data : null

  it('t=0 — первая точка с её скоростью', () => {
    if (!route) throw new Error('образец не разобран')
    const st = routeStateAt(route, 0)
    expect(st.pos.lat).toBeCloseTo(route.points[0].lat, 12)
    expect(st.pos.lon).toBeCloseTo(route.points[0].lon, 12)
    expect(st.altitudeM).toBe(204)
    expect(st.speedKmh).toBe(120)
  })

  it('t=T — последняя точка', () => {
    if (!route) throw new Error('образец не разобран')
    const st = routeStateAt(route, routeDurationS(route))
    expect(st.pos.lat).toBeCloseTo(route.points[3].lat, 12)
    expect(st.altitudeM).toBe(1046)
  })

  it('высота внутри участка интерполируется линейно', () => {
    // Синтетический маршрут с известными временами участков
    const simple: RouteData = {
      tripodHeightM: 0,
      points: [
        { lat: 50, lon: 36, altitudeM: 200, speedKmh: 180 },
        { lat: 50, lon: 36.5, altitudeM: 400, speedKmh: 180 },
      ],
    }
    const tMid = routeDurationS(simple) / 2
    const stMid = routeStateAt(simple, tMid)
    expect(stMid.altitudeM).toBeCloseTo(300, 6)
    // И на образце: середина первого участка — (204 + 362) / 2
    if (!route) throw new Error('образец не разобран')
    const firstEnd = routeDurationS({ ...route, points: [route.points[0], route.points[1]] })
    const stFirst = routeStateAt(route, firstEnd / 2)
    expect(stFirst.altitudeM).toBeCloseTo((204 + 362) / 2, 0)
  })

  it('за пределами времени клампится к концам', () => {
    if (!route) throw new Error('образец не разобран')
    const st0 = routeStateAt(route, -10)
    expect(st0.altitudeM).toBe(204)
    const stT = routeStateAt(route, routeDurationS(route) + 100)
    expect(stT.altitudeM).toBe(1046)
  })

  it('в середине обратного участка доплер меняет знак (движение к Tx)', () => {
    // Туда (10 км) и обратно к Tx: на обратном пути радиальная скорость отрицательна
    const p1 = destination(A, 10000, 90)
    const p2 = destination(A, 20000, 90)
    const route: RouteData = {
      tripodHeightM: 4,
      points: [
        { ...A, altitudeM: 500, speedKmh: 150 },
        { ...p1, altitudeM: 500, speedKmh: 150 },
        { ...p2, altitudeM: 500, speedKmh: 150 },
        { ...p1, altitudeM: 500, speedKmh: 150 },
      ],
    }
    const dyn = simulateDynamics(makeInput(), makeParams(), opts, route)
    // Чуть после старта — удаляемся (в t=0 луч вертикальный и радиальная скорость нулевая)
    const first = dyn.samples[Math.min(5, dyn.samples.length - 1)].dopplerHz
    const last = dyn.samples[dyn.samples.length - 1].dopplerHz
    expect(first).toBeGreaterThan(0)
    expect(last).toBeLessThan(0)
  })
})

describe('Динамика по маршруту', () => {
  it('коллинеарный маршрут с постоянной скоростью/высотой совпадает с прямой моделью', () => {
    const route = straightRoute()
    const params = makeParams()
    const direct = simulateDynamics(makeInput(), params, opts)
    const viaRoute = simulateDynamics(makeInput(), params, opts, route)
    expect(viaRoute.samples.length).toBe(direct.samples.length)
    for (let i = 0; i < direct.samples.length; i++) {
      const a = direct.samples[i]
      const b = viaRoute.samples[i]
      expect(Math.abs(a.pathLossDb - b.pathLossDb)).toBeLessThan(0.05)
      if (Math.abs(a.dopplerHz) > 1) {
        expect(Math.abs(a.dopplerHz - b.dopplerHz) / Math.abs(a.dopplerHz)).toBeLessThan(0.005)
      }
    }
  })

  it('сэмплы маршрута несут переменные высоту и скорость', () => {
    const res = parseRouteFile(sampleText)
    if (!res.ok) throw new Error('образец не разобран')
    const dyn = simulateDynamics(makeInput(), makeParams(), opts, res.data)
    expect(dyn.samples[0].altitudeM).toBe(204)
    expect(dyn.samples[0].speedKmh).toBe(120)
    // На последнем участке скорость 130
    expect(dyn.samples[dyn.samples.length - 1].speedKmh).toBe(130)
    // Прямая ветка — поля не заполнены
    const direct = simulateDynamics(makeInput(), makeParams(), opts)
    expect(direct.samples[0].altitudeM).toBeUndefined()
    expect(direct.samples[0].speedKmh).toBeUndefined()
  })

  it('скорость точек вне 100–200 км/ч даёт предупреждение', () => {
    const route: RouteData = {
      tripodHeightM: 4,
      points: [0, 1, 2, 3].map((i) => ({ lat: 50 + i * 0.01, lon: 36, altitudeM: 500, speedKmh: i === 1 ? 60 : 150 })),
    }
    const dyn = simulateDynamics(makeInput(), makeParams(), opts, route)
    expect(dyn.warnings.some((w) => w.includes('вне диапазона 100–200'))).toBe(true)
  })
})
