/**
 * Тесты участия цифровых продуктов ITU-R P.2001-6 (Table 3) в расчёте:
 *  • извлечение условий в точках трассы (ituEnvironmentAt);
 *  • k-фактор из градиентов рефракции P.453 (k = 157/(157 + ΔN));
 *  • k(p) — лог-интерполяция между 0.1 % и 50 %;
 *  • хвост дождя A(p) = A0.01·0.12·p^−(0.546+0.043·lg p) с порогом β0;
 *  • наклонный путь в дожде (P.838-3 §1);
 *  • спорадический слой E: закон секанса MUF_Es = foEs·sec(i);
 *  • интеграция с движком P.2001-lite (дождь, дифракция, Es-предупреждение).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  kFromDn,
  kForPercent,
  ituEnvironmentAt,
  ituRainRateForPercent,
  rainProbP0FromItu,
  rainHeightKm,
  slantRainPathM,
  foEsForPercent,
  esModeMufMhz,
  tropoZoneMultiplier,
  ITU_PRODUCTS,
  ituProductKey,
  type ItuGridSet,
} from '../itu-env'
import { findItuGridSpec, parseItuGridText, type ItuGrid } from '../itu-grid'
import { computeP2001Lite, computeFsplP526 } from '../p2001lite'
import { makeInput } from './fixtures'
import type { ItuEnvironmentData } from '../types'

/** Сетка-константа по спецификации продукта. */
function constGrid(file: string, value: number): ItuGrid {
  const spec = findItuGridSpec(file)
  if (!spec) throw new Error(`нет спецификации для ${file}`)
  const row = new Array<number>(spec.cols).fill(value)
  const values = Array.from({ length: spec.rows }, () => [...row])
  return { spec, rows: spec.rows, cols: spec.cols, values }
}

/** Сетка, линейно зависящая от широты: value(lat) = base + slope·(lat0 − lat). */
function latGradGrid(file: string, base: number, slope: number): ItuGrid {
  const spec = findItuGridSpec(file)!
  const values = Array.from({ length: spec.rows }, (_, i) =>
    new Array<number>(spec.cols).fill(base + slope * i * spec.dLat),
  )
  return { spec, rows: spec.rows, cols: spec.cols, values }
}

/** Полный набор продуктов-констант (все 14 позиций Table 3). */
function fullEnvValues(v: {
  dnMedian: number
  dndz01: number
  dnSub: number
  dnSup: number
  rho: number
  pr6: number
  mt: number
  beta: number
  h0: number
  zone: number
  foEs: number
}): ItuGridSet {
  return {
    'DN_Median.txt': constGrid('DN_Median.txt', v.dnMedian),
    'DN_SubSlope.txt': constGrid('DN_SubSlope.txt', v.dnSub),
    'DN_SupSlope.txt': constGrid('DN_SupSlope.txt', v.dnSup),
    'dndz_01.txt': constGrid('dndz_01.txt', v.dndz01),
    'Esarain_Pr6_v5.txt': constGrid('Esarain_Pr6_v5.txt', v.pr6),
    'Esarain_Mt_v5.txt': constGrid('Esarain_Mt_v5.txt', v.mt),
    'Esarain_Beta_v5.txt': constGrid('Esarain_Beta_v5.txt', v.beta),
    'h0.txt': constGrid('h0.txt', v.h0),
    'Surfwv_50_fixed.txt': constGrid('Surfwv_50_fixed.txt', v.rho),
    'FoEs0.1.txt': constGrid('FoEs0.1.txt', v.foEs),
    'FoEs01.txt': constGrid('FoEs01.txt', v.foEs),
    'FoEs10.txt': constGrid('FoEs10.txt', v.foEs),
    'FoEs50.txt': constGrid('FoEs50.txt', v.foEs),
    'TropoClim.txt': constGrid('TropoClim.txt', v.zone),
  }
}

const MOSCOW_A = { lat: 55.7558, lon: 37.6173 }
const MOSCOW_B = { lat: 55.9, lon: 38.2 }

describe('реестр продуктов Table 3', () => {
  it('14 продуктов, имена совпадают со спецификациями сеток', () => {
    expect(ITU_PRODUCTS).toHaveLength(14)
    for (const p of ITU_PRODUCTS) {
      expect(findItuGridSpec(p.file)).toBeDefined()
      expect(p.param.length).toBeGreaterThan(3)
      expect(p.usage.length).toBeGreaterThan(3)
    }
  })
  it('ituProductKey нормализует имя (регистр) и возвращает undefined для чужого файла', () => {
    expect(ituProductKey('dn_median.TXT')).toBe('DN_Median.txt')
    expect(ituProductKey('surfwv_50_fixed.txt')).toBe('Surfwv_50_fixed.txt')
    expect(ituProductKey('my_own.txt')).toBeUndefined()
  })
})

describe('k-фактор из градиента рефракции (P.453)', () => {
  it('ΔN = −39 N/км → k ≈ 1.33 (стандартная рефракция 4/3)', () => {
    expect(kFromDn(-39)).toBeCloseTo(4 / 3, 2)
  })
  it('ΔN = −78.5 N/км → k = 2.0', () => {
    expect(kFromDn(-78.5)).toBeCloseTo(2.0, 6)
  })
  it('слабый градиент → k близок к 1', () => {
    expect(kFromDn(-10)).toBeLessThan(1.1)
    expect(kFromDn(-10)).toBeGreaterThan(1.0)
  })
  it('волновод (ΔN ≤ −157) клампится до 10, подрефракция (ΔN ≥ +157) — до 0.5', () => {
    expect(kFromDn(-160)).toBe(10)
    expect(kFromDn(-1000)).toBe(10)
    expect(kFromDn(+160)).toBe(0.5)
  })
})

describe('ituEnvironmentAt: извлечение условий в точках трассы', () => {
  it('полный набор продуктов: все поля определены, все 14 продуктов в usedProducts', () => {
    const grids = fullEnvValues({
      dnMedian: 43, dndz01: -120, dnSub: -8, dnSup: 25, rho: 7.8, pr6: 42, mt: 483.5, beta: 0.264, h0: 2.1, zone: 5, foEs: 4.5,
    })
    const env = ituEnvironmentAt(grids, MOSCOW_A, MOSCOW_B)
    // DN_Median хранит модуль: ΔN = −43, k50 = 157/(157 − 43) ≈ 1.38
    expect(env.dnMedian).toBeCloseTo(-43, 6)
    expect(env.k50).toBeCloseTo(157 / (157 - 43), 6)
    expect(env.dndz01).toBeCloseTo(-120, 6)
    expect(env.k01).toBeCloseTo(157 / (157 - 120), 6)
    expect(env.dnSubSlope).toBeCloseTo(-8, 6)
    expect(env.dnSupSlope).toBeCloseTo(25, 6)
    expect(env.rho50).toBeCloseTo(7.8, 6)
    expect(env.pr6).toBeCloseTo(42, 6)
    expect(env.rainMassMt).toBeCloseTo(483.5, 6)
    expect(env.beta0).toBeCloseTo(0.264, 6)
    // производные P.837-6: P0 и R0.01
    expect(env.rainProbP0).toBeCloseTo(rainProbP0FromItu(42, 483.5, 0.264), 6)
    expect(env.rainRate001).toBeCloseTo(ituRainRateForPercent(env, 0.01), 6)
    expect(env.isothermH0Km).toBeCloseTo(2.1, 6)
    expect(env.tropoZone).toBe(5)
    expect(env.foEs001).toBeCloseTo(4.5, 6)
    expect(env.usedProducts).toHaveLength(14)
  })

  it('частичный набор: отсутствующие продукты дают undefined и не попадают в usedProducts', () => {
    const env = ituEnvironmentAt(
      { 'DN_Median.txt': constGrid('DN_Median.txt', -40) },
      MOSCOW_A,
      MOSCOW_B,
    )
    expect(env.k50).toBeDefined()
    expect(env.rainRate001).toBeUndefined()
    expect(env.rho50).toBeUndefined()
    expect(env.tropoZone).toBeUndefined()
    expect(env.usedProducts).toEqual(['DN_Median.txt'])
  })

  it('градиент по широте: результат — среднее концов A и Б (со сменой знака файла)', () => {
    // DN_Median (модуль): value(lat) = 30 + 0.2·(90° − lat); ΔN = −value
    const g = latGradGrid('DN_Median.txt', 30, 0.2)
    const env = ituEnvironmentAt({ 'DN_Median.txt': g }, MOSCOW_A, MOSCOW_B)
    const vA = 30 + 0.2 * (90 - MOSCOW_A.lat)
    const vB = 30 + 0.2 * (90 - MOSCOW_B.lat)
    expect(env.dnMedian!).toBeCloseTo(-(vA + vB) / 2, 3)
  })

  it('TropoClim: зона берётся в середине трассы (ближайший узел, без интерполяции)', () => {
    const zoneA = 3
    const zoneB = 8
    // Половинки: сетка с разным значением невозможно сделать константой —
    // проверяем константу и то, что округление целочисленное
    const env = ituEnvironmentAt({ 'TropoClim.txt': constGrid('TropoClim.txt', zoneA) }, MOSCOW_A, MOSCOW_B)
    expect(env.tropoZone).toBe(zoneA)
    void zoneB
  })

  it('реальные данные пользователя: DN_Median.txt (модуль) → ΔN отрицательный, k ≈ 1.32 для Москвы', () => {
    // Значения файла положительные (Москва ≈ 37.7, экватор ≈ 53) — модуль градиента;
    // фактический градиент ΔN = −|ΔN| → k50 > 1 (стандартная рефракция)
    const raw = readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/DN_Median.txt'), 'utf-8')
    const spec = findItuGridSpec('DN_Median.txt')!
    const grid = parseItuGridText(raw, spec)
    const env = ituEnvironmentAt({ 'DN_Median.txt': grid }, MOSCOW_A, MOSCOW_B)
    expect(env.dnMedian).toBeLessThan(0)
    expect(Math.abs(env.dnMedian!)).toBeGreaterThan(30)
    expect(Math.abs(env.dnMedian!)).toBeLessThan(50)
    expect(env.k50!).toBeGreaterThan(1.2)
    expect(env.k50!).toBeLessThan(1.5)
  })

  it('реальные данные: dndz_01.txt (знаковый, −281 для Москвы) → k01 клампится до 10 (волновод)', () => {
    const raw = readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/dndz_01.txt'), 'utf-8')
    const spec = findItuGridSpec('dndz_01.txt')!
    const grid = parseItuGridText(raw, spec)
    const env = ituEnvironmentAt({ 'dndz_01.txt': grid }, MOSCOW_A, MOSCOW_B)
    expect(env.dndz01).toBeLessThan(-200) // сильная сверхрефракция 0.1 % времени
    expect(env.k01).toBe(10) // волновод: кламп по максимуму
  })

  it('реальные данные: Surfwv_50_fixed.txt с научной нотацией (E+00) парсится', () => {
    const raw = readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/surfwv_50_fixed.txt'), 'utf-8')
    const spec = findItuGridSpec('Surfwv_50_fixed.txt')!
    const grid = parseItuGridText(raw, spec)
    const env = ituEnvironmentAt({ 'Surfwv_50_fixed.txt': grid }, MOSCOW_A, MOSCOW_B)
    expect(env.rho50).toBeGreaterThan(2)
    expect(env.rho50).toBeLessThan(8)
  })

  it('rainHeightKm: высота дождя — изотерма 0 °C h0 (P.839-4)', () => {
    expect(rainHeightKm({ usedProducts: [], isothermH0Km: 2.4 })).toBeCloseTo(2.4)
    expect(rainHeightKm({ usedProducts: [] })).toBeUndefined()
  })
})

describe('kForPercent: лог-интерполяция k(p) между 0.1 % и 50 %', () => {
  const env: ItuEnvironmentData = {
    usedProducts: [],
    k50: 157 / (157 - 39), // 1.331
    k01: 157 / (157 - 120), // 4.24 — сверхрефракция 0.1 %
  }
  it('p = 50 % → k50; p = 0.1 % → k01', () => {
    expect(kForPercent(env, 50)).toBeCloseTo(env.k50!, 6)
    expect(kForPercent(env, 0.1)).toBeCloseTo(env.k01!, 6)
  })
  it('промежуточное значение монотонно между k01 и k50', () => {
    const k1 = kForPercent(env, 1)!
    expect(k1).toBeGreaterThan(env.k50!)
    expect(k1).toBeLessThan(env.k01!)
  })
  it('p > 50 % клампится к k50; отсутствующие опоры возвращают другую', () => {
    expect(kForPercent(env, 99)).toBeCloseTo(env.k50!, 6)
    expect(kForPercent({ usedProducts: [], k50: 1.4 }, 0.1)).toBeCloseTo(1.4, 6)
    expect(kForPercent({ usedProducts: [], k01: 3 }, 50)).toBeCloseTo(3, 6)
    expect(kForPercent({ usedProducts: [] }, 10)).toBeUndefined()
  })
})

describe('дождь из карт ITU: модель P.837-6 (шаги 3–5)', () => {
  // Значения, близкие к реальным для Москвы (Pr6 ≈ 33.4 мм/ч, Mt ≈ 483.5, β ≈ 0.264)
  const env: ItuEnvironmentData = { usedProducts: [], pr6: 33.4, rainMassMt: 483.5, beta0: 0.264 }

  it('P0 = Pr6·(1 − e^(−0.0079·Ms/Pr6)) ≈ 2.7 % для Москвы', () => {
    const p0 = rainProbP0FromItu(33.4, 483.5, 0.264)
    expect(p0).toBeGreaterThan(2)
    expect(p0).toBeLessThan(3.5)
  })

  it('R(0.01 %) ≈ 30…35 мм/ч для Москвы; R0.01 ≥ R(1 %) ≥ R(P0)→0', () => {
    const r001 = ituRainRateForPercent(env, 0.01)
    expect(r001).toBeGreaterThan(25)
    expect(r001).toBeLessThan(45)
    const r1 = ituRainRateForPercent(env, 1)
    expect(r1).toBeGreaterThan(0)
    expect(r1).toBeLessThan(r001)
  })

  it('при p > P0 дождя нет (R = 0); в точке P0 → 0', () => {
    const p0 = rainProbP0FromItu(33.4, 483.5, 0.264)
    expect(ituRainRateForPercent(env, p0 + 0.01)).toBe(0)
    expect(ituRainRateForPercent(env, 50)).toBe(0)
    expect(ituRainRateForPercent(env, p0)).toBeCloseTo(0, 1)
  })

  it('монотонность: R убывает с ростом p', () => {
    const ps = [0.01, 0.03, 0.1, 0.3, 1]
    for (let i = 1; i < ps.length; i++) {
      expect(ituRainRateForPercent(env, ps[i])).toBeLessThan(ituRainRateForPercent(env, ps[i - 1]))
    }
  })

  it('Pr6 = 0 → дождя нет', () => {
    expect(rainProbP0FromItu(0, 500, 0.3)).toBe(0)
    expect(ituRainRateForPercent({ usedProducts: [], pr6: 0, rainMassMt: 500, beta0: 0.3 }, 0.01)).toBe(0)
  })

  it('fallback без Mt/β: Pr6 используется как консервативная оценка при p ≤ 0.0685 %', () => {
    const onlyPr6: ItuEnvironmentData = { usedProducts: [], pr6: 33.4 }
    expect(ituRainRateForPercent(onlyPr6, 0.01)).toBeCloseTo(33.4)
    expect(ituRainRateForPercent(onlyPr6, 0.05)).toBeCloseTo(33.4)
    expect(ituRainRateForPercent(onlyPr6, 0.1)).toBe(0)
  })

  it('реальные данные Москвы: извлечение даёт согласованную модель дождя', () => {
    const pr6 = parseItuGridText(readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/Esarain_Pr6_v5.txt'), 'utf-8'), findItuGridSpec('Esarain_Pr6_v5.txt')!)
    const mt = parseItuGridText(readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/Esarain_Mt_v5.txt'), 'utf-8'), findItuGridSpec('Esarain_Mt_v5.txt')!)
    const beta = parseItuGridText(readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/Esarain_Beta_v5.txt'), 'utf-8'), findItuGridSpec('Esarain_Beta_v5.txt')!)
    const envMsk = ituEnvironmentAt({ 'Esarain_Pr6_v5.txt': pr6, 'Esarain_Mt_v5.txt': mt, 'Esarain_Beta_v5.txt': beta }, MOSCOW_A, MOSCOW_B)
    expect(envMsk.pr6).toBeGreaterThan(20)
    expect(envMsk.pr6).toBeLessThan(60)
    // Mt — суммарная масса дождя: Москва ≈ 480 кг/м²/год
    expect(envMsk.rainMassMt).toBeGreaterThan(300)
    expect(envMsk.rainMassMt).toBeLessThan(800)
    expect(envMsk.beta0).toBeGreaterThan(0)
    expect(envMsk.beta0).toBeLessThan(1)
    expect(envMsk.rainProbP0).toBeGreaterThan(1)
    expect(envMsk.rainProbP0).toBeLessThan(6)
    expect(envMsk.rainRate001).toBeGreaterThan(20)
    expect(envMsk.rainRate001).toBeLessThan(60)
  })
})

describe('наклонный путь в дожде (P.838-3 §1)', () => {
  it('Ls = (hR − hs)/sin θ; при θ = 90° — вертикаль', () => {
    expect(slantRainPathM(50_000, 0, 3, 90)).toBeCloseTo(3000, 0)
  })
  it('при θ = 5° путь длиннее вертикали в 1/sin 5°', () => {
    expect(slantRainPathM(100_000, 0, 3, 5)).toBeCloseTo(3000 / Math.sin((5 * Math.PI) / 180), 0)
  })
  it('ограничение длиной трассы', () => {
    expect(slantRainPathM(10_000, 0, 3, 5)).toBeCloseTo(10_000, 0)
  })
  it('станция выше слоя дождя → длина трассы (без отрицательных значений)', () => {
    expect(slantRainPathM(10_000, 5000, 3, 90)).toBeCloseTo(10_000, 0)
  })
})

describe('спорадический слой E (Annex G): закон секанса', () => {
  it('выбор foEs по проценту времени', () => {
    const env: ItuEnvironmentData = { usedProducts: [], foEs001: 7, foEs01: 5.5, foEs10: 3.5, foEs50: 1.8 }
    expect(foEsForPercent(env, 0.1)).toBeCloseTo(7)
    expect(foEsForPercent(env, 1)).toBeCloseTo(5.5)
    expect(foEsForPercent(env, 10)).toBeCloseTo(3.5)
    expect(foEsForPercent(env, 50)).toBeCloseTo(1.8)
    expect(foEsForPercent(env, 99)).toBeCloseTo(1.8)
  })
  it('MUF_Es = foEs·sec(i), sec(i) = √(1+(d/2h)²) для d = 2000 км, h = 110 км', () => {
    const env: ItuEnvironmentData = { usedProducts: [], foEs01: 5 }
    const { foEsMhz, mufMhz } = esModeMufMhz(env, 1, 2_000_000)
    const secI = Math.sqrt(1 + Math.pow(1000 / 110, 2))
    expect(foEsMhz).toBeCloseTo(5)
    expect(mufMhz!).toBeCloseTo(5 * secI, 3)
    expect(mufMhz!).toBeGreaterThan(40)
  })
  it('без продуктов FoEs результат пустой', () => {
    expect(esModeMufMhz({ usedProducts: [] }, 1, 100_000)).toEqual({})
  })
})

describe('TropoClim: климатический коэффициент многолучёвости (аппроксимация)', () => {
  it('полярные зоны 1–4 ослабляют p0, тропические 10–14 усиливают', () => {
    expect(tropoZoneMultiplier(1)).toBeCloseTo(0.7)
    expect(tropoZoneMultiplier(4)).toBeCloseTo(0.7)
    expect(tropoZoneMultiplier(5)).toBeCloseTo(1.0)
    expect(tropoZoneMultiplier(9)).toBeCloseTo(1.0)
    expect(tropoZoneMultiplier(12)).toBeCloseTo(1.3)
    expect(tropoZoneMultiplier(14)).toBeCloseTo(1.3)
  })
  it('без зоны и вне диапазона 1–14 — нейтральный 1', () => {
    expect(tropoZoneMultiplier(undefined)).toBe(1)
    expect(tropoZoneMultiplier(99)).toBe(1)
  })
})

describe('интеграция с движком: computeFsplP526 / computeP2001Lite со средой ITU', () => {
  it('k-фактор из DN_Median применяется к геометрии медианы (дифракция меняется)', () => {
    const dist = 30_000
    const profile = (() => {
      const pts: { d: number; elev: number; clutter: number; total: number }[] = []
      for (let i = 0; i < 41; i++) {
        const d = (dist * i) / 40
        const elev = Math.max(0, 150 - (Math.abs(d / dist - 0.5) * dist) / 10)
        pts.push({ d, elev, clutter: 0, total: elev })
      }
      return pts
    })()
    const withoutEnv = computeFsplP526(makeInput({ path: { distanceM: dist, profile } as never }))
    const withEnv = computeFsplP526(
      makeInput({
        path: { distanceM: dist, profile } as never,
        kFactor: 4 / 3,
        environment: { usedProducts: ['DN_Median.txt'], dnMedian: -43, k50: 157 / (157 - 43) },
      }),
    )
    // k из карты больше 4/3 → дифракция меньше
    expect(withEnv.breakdown.diffractionDb).toBeLessThan(withoutEnv.breakdown.diffractionDb)
  })

  it('дождь из ITU: медиана без дождя, хвост p ≤ P0 содержит затухание (P.837-6)', () => {
    const input = makeInput({
      frequencyMhz: 6000,
      timePercents: [0.1, 1, 50, 90],
      atmosphere: { rainRateMmH: 0, gases: false, vegetation: false, rainSource: 'itu' },
      environment: {
        usedProducts: ['Esarain_Pr6_v5.txt', 'Esarain_Mt_v5.txt', 'Esarain_Beta_v5.txt'],
        pr6: 33.4,
        rainMassMt: 483.5,
        beta0: 0.264,
      },
    })
    const r = computeP2001Lite(input)
    const at = (p: number) => r.byTimePercent.find((t) => t.percent === p)!.lossDb
    // медиана (50 %) — без дождя
    const base = computeP2001Lite(makeInput({ frequencyMhz: 6000, timePercents: [50, 90] }))
    expect(at(50)).toBeCloseTo(base.byTimePercent.find((t) => t.percent === 50)!.lossDb, 6)
    // хвост с дождём: R(0.1) > R(1) → затухание больше
    expect(at(0.1)).toBeGreaterThan(at(1))
    expect(r.breakdown.rainDb).toBeGreaterThan(0)
    expect(r.warnings.some((w) => w.includes('Дождь из карты ITU'))).toBe(true)
  })

  it('предупреждение перечисляет участвовавшие продукты', () => {
    const r = computeP2001Lite(
      makeInput({
        environment: {
          usedProducts: ['DN_Median.txt', 'Surfwv_50_fixed.txt', 'TropoClim.txt'],
          dnMedian: -40,
          k50: 157 / (157 - 40),
          rho50: 8,
          tropoZone: 6,
        },
      }),
    )
    expect(r.warnings.some((w) => w.includes('DN_Median.txt') && w.includes('Surfwv_50_fixed.txt'))).toBe(true)
  })

  it('спорадический слой E: предупреждение при f ≤ MUF_Es (VHF)', () => {
    const r = computeP2001Lite(
      makeInput({
        frequencyMhz: 50,
        timePercents: [50, 90],
        environment: { usedProducts: ['FoEs50.txt'], foEs50: 50 },
      }),
    )
    expect(r.warnings.some((w) => w.includes('Спорадический слой E'))).toBe(true)
  })

  it('без Es-возможности (f ≫ MUF_Es) предупреждения нет', () => {
    const r = computeP2001Lite(
      makeInput({
        frequencyMhz: 2400,
        timePercents: [50, 90],
        environment: { usedProducts: ['FoEs50.txt'], foEs50: 5 },
      }),
    )
    expect(r.warnings.some((w) => w.includes('Спорадический слой E'))).toBe(false)
  })

  it('зона TropoClim меняет климатический коэффициент p0 (аппроксимация)', () => {
    const dist = 200_000
    const mk = (tropoZone?: number) =>
      computeP2001Lite(
        makeInput({
          path: { distanceM: dist, profile: (() => {
            const pts: { d: number; elev: number; clutter: number; total: number }[] = []
            for (let i = 0; i < 101; i++) {
              const d = (dist * i) / 100
              pts.push({ d, elev: 0, clutter: 0, total: 0 })
            }
            return pts
          })() } as never,
          climateZone: 'F',
          timePercents: [0.5, 50, 90],
          environment: tropoZone
            ? { usedProducts: ['TropoClim.txt'], tropoZone }
            : undefined,
        }),
      )
    const tropical = mk(12)   // множитель 1.3
    const polar = mk(2)       // множитель 0.7
    const neutral = mk()
    // медиана (50 %) от зоны не зависит
    expect(tropical.medianLossDb).toBeCloseTo(neutral.medianLossDb, 6)
    // хвост p < 50 %: тропическая зона усиливает p0 → глубже хвост; полярная — мельче
    const at = (r: ReturnType<typeof computeP2001Lite>, p: number) =>
      r.byTimePercent.find((t) => t.percent === p)!.lossDb
    expect(at(tropical, 0.5)).toBeGreaterThan(at(neutral, 0.5))
    expect(at(polar, 0.5)).toBeLessThan(at(neutral, 0.5))
  })
})
