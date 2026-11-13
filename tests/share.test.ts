/**
 * Тесты share-ссылки (этап UX.1): round-trip encode/decode, толерантный
 * декод (невалидное поле игнорируется), отказ при отсутствии точек.
 */
import { describe, it, expect } from 'bun:test'
import { decodeShareHash, encodeShareHash, type ShareSource } from '../src/lib/radio/share'
import { DEFAULT_EQUIPMENT } from '../src/store/radio-store'

const state: ShareSource = {
  pointA: { lat: 55.7558, lon: 37.6173 },
  pointB: { lat: 55.8305, lon: 37.8501 },
  frequencyMhz: 2400,
  frequencyMode: 'single',
  freqFromMhz: 2400,
  freqToMhz: 2480,
  mobileFrequencyMhz: 2480,
  mobileFrequencyMode: 'range',
  mobileFreqFromMhz: 2400,
  mobileFreqToMhz: 2500,
  polarization: 'horizontal',
  txHeightM: 30,
  rxHeightM: 10,
  kFactor: 4 / 3,
  climateZone: 'K',
  atmosphere: { rainRateMmH: 12.5, gases: true, vegetation: false },
  equipment: { ...DEFAULT_EQUIPMENT, mode: 'detailed' },
  model: 'itm',
}

describe('share: encode/decode round-trip', () => {
  it('round-trip сохраняет все поля', () => {
    const hash = encodeShareHash(state)
    const decoded = decodeShareHash(hash)
    expect(decoded).not.toBeNull()
    expect(decoded!.pointA).toEqual(state.pointA)
    expect(decoded!.pointB).toEqual(state.pointB)
    expect(decoded!.frequencyMhz).toBe(2400)
    expect(decoded!.frequencyMode).toBe('single')
    expect(decoded!.mobileFrequencyMhz).toBe(2480)
    expect(decoded!.mobileFrequencyMode).toBe('range')
    expect(decoded!.mobileFreqFromMhz).toBe(2400)
    expect(decoded!.mobileFreqToMhz).toBe(2500)
    expect(decoded!.polarization).toBe('horizontal')
    expect(decoded!.txHeightM).toBe(30)
    expect(decoded!.rxHeightM).toBe(10)
    expect(decoded!.kFactor).toBeCloseTo(4 / 3, 2)
    expect(decoded!.climateZone).toBe('K')
    expect(decoded!.atmosphere).toEqual({ rainRateMmH: 12.5, gases: true, vegetation: false })
    expect(decoded!.model).toBe('itm')
    expect(decoded!.run).toBe(true)
  })

  it('equipment проходит туда-обратно', () => {
    const decoded = decodeShareHash(encodeShareHash(state))!
    expect(decoded.equipment).toEqual(state.equipment)
  })

  it('диапазон наземной частоты сериализуется', () => {
    const withRange: ShareSource = { ...state, frequencyMode: 'range' }
    const decoded = decodeShareHash(encodeShareHash(withRange))!
    expect(decoded.frequencyMode).toBe('range')
    expect(decoded.freqFromMhz).toBe(2400)
    expect(decoded.freqToMhz).toBe(2480)
  })
})

describe('share: толерантный декод', () => {
  it('только точки — остальное не применяется, run отсутствует', () => {
    const decoded = decodeShareHash('a=55.0,37.0&b=55.1,37.1')
    expect(decoded).not.toBeNull()
    expect(decoded!.pointA).toEqual({ lat: 55.0, lon: 37.0 })
    expect(decoded!.pointB).toEqual({ lat: 55.1, lon: 37.1 })
    expect(decoded!.frequencyMhz).toBeUndefined()
    expect(decoded!.run).toBe(false)
  })

  it('run=1 распознаётся', () => {
    const decoded = decodeShareHash('a=55.0,37.0&b=55.1,37.1&run=1')
    expect(decoded!.run).toBe(true)
  })

  it('нет точек / мусор — null', () => {
    expect(decodeShareHash('')).toBeNull()
    expect(decodeShareHash('f=2400&pol=v')).toBeNull()
    expect(decodeShareHash('a=999,37.0&b=55.1,37.1')).toBeNull()
    expect(decodeShareHash('a=мусор&b=55.1,37.1')).toBeNull()
  })

  it('невалидные опциональные поля игнорируются, валидные применяются', () => {
    const decoded = decodeShareHash('a=55.0,37.0&b=55.1,37.1&f=99999&pol=x&k=0.1&htx=25&md=musor&run=1')
    expect(decoded!.frequencyMhz).toBeUndefined()
    expect(decoded!.polarization).toBeUndefined()
    expect(decoded!.kFactor).toBeUndefined() // ниже минимума 0.5
    expect(decoded!.txHeightM).toBe(25)
    expect(decoded!.model).toBeUndefined()
    expect(decoded!.run).toBe(true)
  })

  it('битый equipment игнорируется', () => {
    const decoded = decodeShareHash('a=55.0,37.0&b=55.1,37.1&eq=%%%bitoe')
    expect(decoded!.equipment).toBeUndefined()
    const decoded2 = decodeShareHash('a=55.0,37.0&b=55.1,37.1&eq=' + btoa('{"mode":"simple"}'))
    expect(decoded2!.equipment).toBeUndefined() // нет tx/rx — схема не проходит
  })
})
