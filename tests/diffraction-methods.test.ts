/**
 * Тесты сравнения методов дифракции (роадмап 1.3): Эпштейн–Петерсон против
 * Буллингтона и Дейгаута. Эталон — 2-краевая трасса, все числа выведены вручную:
 * 30 км, 2400 МГц (λ = 0.12492 м), K = 4/3, антенны по 20 м, два одинаковых
 * ребра 60 м на 10 и 20 км. Выпуклость Земли: 11.77 м над полным путём,
 * 5.89 м над подпутями 20 км.
 * Ожидаемая картина (классический разброс на многопрепятственной трассе):
 * Дейгаут ≈ 35.8 дБ, ЭП ≈ 33.2 дБ, Буллингтон ≈ 21.0 дБ — схлопывание
 * в одно ребро занижает потери на ~14 дБ относительно остальных методов.
 */
import { describe, it, expect } from 'bun:test'
import {
  bullingtonLossDb,
  deygoutLossDb,
  epsteinPetersonLossDb,
  diffractionMethodsDb,
  extractEdges,
  knifeEdgeV,
  knifeEdgeLossDb,
  type Edge,
} from '../src/lib/radio/diffraction'
import { earthBulgeM } from '../src/lib/radio/fspl'

const D = 30000
const F = 2400
const K = 4 / 3
const TXH = 20
const RXH = 20

const TWO_EDGES: Edge[] = [
  { d: 10000, h: 60 },
  { d: 20000, h: 60 },
]

// Ручной расчёт v-параметров эталонной трассы (знаменатель v на подпуте 20 км: √(λ·5000) = 24.99)
const vDom = knifeEdgeV(10000, 20000, 60 + earthBulgeM(10000, D, K) - TXH, F) // доминирующее ребро по полному пути
const vRight = knifeEdgeV(10000, 10000, 20, F) // правая ветвь Дейгаута: hAbove ровно 20 м
const vEp = knifeEdgeV(10000, 10000, 60 + earthBulgeM(10000, 20000, K) - 40, F) // ребро над LOS подпутя TX→E2 (40 м)

describe('Дифракция: Эпштейн–Петерсон (2-краевая эталонная трасса)', () => {
  it('контрольные величины ручного расчёта', () => {
    expect(earthBulgeM(10000, D, K)).toBeCloseTo(11.7717, 3)
    expect(earthBulgeM(10000, 20000, K)).toBeCloseTo(5.8859, 3)
    expect(vDom).toBeCloseTo(2.5373, 3)
    expect(vRight).toBeCloseTo(1.1318, 3)
    expect(vEp).toBeCloseTo(1.4649, 3)
  })

  it('ЭП: сумма J(v) по рёбрам, у обоих рёбер одинаковый подпуть → 2·J(vEp)', () => {
    expect(epsteinPetersonLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(2 * knifeEdgeLossDb(vEp), 6)
    expect(epsteinPetersonLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(33.21, 1)
  })

  it('Буллингтон: пересечение касательных в первом ребре → J(vDom)', () => {
    expect(bullingtonLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(knifeEdgeLossDb(vDom), 6)
    expect(bullingtonLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(21.0, 1)
  })

  it('Дейгаут: доминирующее ребро + вложенная правая ветвь → J(vDom) + J(vRight)', () => {
    expect(deygoutLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(knifeEdgeLossDb(vDom) + knifeEdgeLossDb(vRight), 6)
    expect(deygoutLossDb(TWO_EDGES, TXH, RXH, D, F, K)).toBeCloseTo(35.75, 1)
  })

  it('развертка методов: текущая = max(Дейгаут, Буллингтон), разброс ≈ 15 дБ', () => {
    const m = diffractionMethodsDb(
      [
        { d: 0, elev: 0 },
        { d: 5000, elev: 0 },
        { d: 10000, elev: 60 },
        { d: 15000, elev: 0 },
        { d: 20000, elev: 60 },
        { d: 25000, elev: 0 },
        { d: 30000, elev: 0 },
      ],
      TXH,
      RXH,
      F,
      K,
    )
    expect(m).not.toBeNull()
    expect(m!.edgeCount).toBe(2)
    expect(m!.deygoutDb).toBeCloseTo(knifeEdgeLossDb(vDom) + knifeEdgeLossDb(vRight), 6)
    expect(m!.bullingtonDb).toBeCloseTo(knifeEdgeLossDb(vDom), 6)
    expect(m!.epsteinPetersonDb).toBeCloseTo(2 * knifeEdgeLossDb(vEp), 6)
    expect(m!.currentDb).toBeCloseTo(Math.max(m!.deygoutDb, m!.bullingtonDb), 9)
    expect(m!.spreadDb).toBeCloseTo(m!.deygoutDb - m!.bullingtonDb, 9)
    expect(m!.spreadDb).toBeGreaterThan(5) // многопрепятственная трасса — методы расходятся
  })
})

describe('Дифракция: Эпштейн–Петерсон на одиночном ребре', () => {
  it('совпадает с ножевым ребром (и с Дейгаутом/Буллингтоном)', () => {
    const one: Edge[] = [{ d: 15000, h: 80 }]
    const v = knifeEdgeV(15000, 15000, 80 + earthBulgeM(15000, D, K) - 20, F)
    const ep = epsteinPetersonLossDb(one, TXH, RXH, D, F, K)
    expect(ep).toBeCloseTo(knifeEdgeLossDb(v), 9)
    expect(deygoutLossDb(one, TXH, RXH, D, F, K)).toBeCloseTo(ep, 9)
    expect(bullingtonLossDb(one, TXH, RXH, D, F, K)).toBeCloseTo(ep, 9)
  })

  it('нет рёбер → 0; extractEdges на плоском профиле даёт максимум', () => {
    expect(epsteinPetersonLossDb([], TXH, RXH, D, F, K)).toBe(0)
    const flat = extractEdges([
      { d: 0, elev: 10 },
      { d: 15000, elev: 30 },
      { d: 30000, elev: 10 },
    ])
    expect(flat).toHaveLength(1)
    expect(flat[0].d).toBe(15000)
  })
})
