/**
 * Тесты бюджета линии (детальный режим, Eb/N0, чувствительность) —
 * дополняют tests/budget.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { computeLinkBudget, sensitivityOk } from '../budget'
import { computeFsplP526 } from '../p2001lite'
import { makeInput, makeEquipment } from './fixtures'
import { KTB_DBM_HZ } from '../constants'

describe('computeLinkBudget: упрощённый режим', () => {
  it('EIRP = P_tx + G_tx (без фидеров)', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const eq = makeEquipment()
    const b = computeLinkBudget(input, eq, prop)
    expect(b.eirpDbm).toBe(eq.transmitter.powerDbm + eq.tx.gainDbi)
    expect(b.ktbDbm).toBeCloseTo(KTB_DBM_HZ + 60, 2) // 1 МГц → +60 дБ
    expect(b.noisePowerDbm).toBeCloseTo(b.ktbDbm + 3, 2)
    expect(b.snrDb).toBeCloseTo(b.prxDbm - b.noisePowerDbm, 6)
    expect(b.linkMarginDb).toBeCloseTo(b.snrDb - b.ebN0RequiredDb, 6)
  })
})

describe('computeLinkBudget: подробный режим', () => {
  it('фидеры и рассогласование уменьшают EIRP и P_rx', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const simple = computeLinkBudget(input, makeEquipment(), prop)
    const detailed = computeLinkBudget(
      input,
      makeEquipment({
        mode: 'detailed',
        tx: { gainDbi: 10, polarization: 'vertical', feederLossDb: 2, mismatchLossDb: 1 },
        rx: { gainDbi: 3, polarization: 'vertical', feederLossDb: 1.5, mismatchLossDb: 0.5 },
        receiver: { powerDbm: 0, sensitivityDbm: -100, noiseFigureDb: 5, noiseBandwidthHz: 1e6 },
      }),
      prop,
    )
    expect(detailed.eirpDbm).toBeCloseTo(simple.eirpDbm - 3, 6)
    // NF=5 вместо 3 → шум на 2 дБ выше
    expect(detailed.noisePowerDbm).toBeCloseTo(simple.noisePowerDbm + 2, 6)
    expect(detailed.snrDb).toBeLessThan(simple.snrDb)
    // строки с фидерами присутствуют в приходе
    expect(detailed.income.some((r) => r.label.includes('фидера Tx'))).toBe(true)
    expect(detailed.income.some((r) => r.label.includes('Рассогласование Rx'))).toBe(true)
  })
  it('полоса шума 100 кГц вместо 1 МГц даёт +10 дБ SNR (в подробном режиме)', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const wide = computeLinkBudget(input, makeEquipment({ mode: 'detailed', receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e6, noiseFigureDb: 3 } }), prop)
    const narrow = computeLinkBudget(
      input,
      makeEquipment({ mode: 'detailed', receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e5, noiseFigureDb: 3 } }),
      prop,
    )
    expect(narrow.snrDb).toBeCloseTo(wide.snrDb + 10, 3)
  })
  it('модуляция влияет на требуемое Eb/N0 и запас (в подробном режиме)', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const qpsk = computeLinkBudget(input, makeEquipment({ mode: 'detailed', receiver: { powerDbm: 0, sensitivityDbm: -100, modulation: 'QPSK', requiredEbN0Db: undefined as never, noiseBandwidthHz: 1e6 } }), prop)
    const qam = computeLinkBudget(input, makeEquipment({ mode: 'detailed', receiver: { powerDbm: 0, sensitivityDbm: -100, modulation: '64QAM', requiredEbN0Db: undefined as never, noiseBandwidthHz: 1e6 } }), prop)
    expect(qam.ebN0RequiredDb).toBe(18.5)
    expect(qam.linkMarginDb).toBeLessThan(qpsk.linkMarginDb)
  })
  it('деградация от доплера учитывается в P_rx', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const base = computeLinkBudget(input, makeEquipment(), prop)
    const withDop = computeLinkBudget(input, makeEquipment(), prop, { dopplerLossDb: 7 })
    expect(withDop.prxDbm).toBeCloseTo(base.prxDbm - 7, 6)
  })
  it('структура таблиц прихода/расхода согласована', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const b = computeLinkBudget(input, makeEquipment(), prop)
    const eirpRow = b.income.find((r) => r.label.includes('EIRP'))!
    expect(eirpRow.value).toBeCloseTo(b.eirpDbm, 6)
    const prxRow = b.expense.find((r) => r.label.includes('P_rx'))!
    expect(prxRow.value).toBeCloseTo(b.prxDbm, 6)
    const marginRow = b.expense.find((r) => r.label === 'Link margin')!
    expect(marginRow.value).toBeCloseTo(b.linkMarginDb, 6)
  })
})

describe('sensitivityOk', () => {
  it('P_rx выше чувствительности → true', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const b = computeLinkBudget(input, makeEquipment({ transmitter: { powerDbm: 40, sensitivityDbm: -100 }, receiver: { powerDbm: 0, sensitivityDbm: -100 } }), prop)
    expect(sensitivityOk(b, makeEquipment({ transmitter: { powerDbm: 40, sensitivityDbm: -100 }, receiver: { powerDbm: 0, sensitivityDbm: -100 } }))).toBe(true)
  })
  it('P_rx ниже чувствительности → false', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const eq = makeEquipment({ receiver: { powerDbm: 0, sensitivityDbm: 10 } }) // заведомо недостижимо
    const b = computeLinkBudget(input, eq, prop)
    expect(sensitivityOk(b, eq)).toBe(false)
  })
})
