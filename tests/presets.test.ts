/**
 * Тесты пользовательских пресетов оборудования (этап UX.2):
 * снимок, merge/replace импорта, экспорт/импорт файла, отказ на мусоре.
 */
import { describe, it, expect } from 'bun:test'
import {
  makePreset,
  mergePresets,
  replacePresets,
  encodePresetsFile,
  parsePresetsFile,
  loadPresets,
  savePresets,
  PRESETS_FILE_VERSION,
  type EquipmentPreset,
} from '../src/lib/radio/presets'

const antenna = { gainDbi: 17, polarization: 'vertical' as const, beamwidthDeg: 90 }
const radio = { powerDbm: 30, sensitivityDbm: -100, modulation: 'QPSK' as const }

const preset: EquipmentPreset = {
  id: 'p1',
  name: 'Сектор 17 дБи',
  station: 'ground',
  createdAt: '2026-11-14T10:00:00.000Z',
  antenna,
  radio,
}

describe('presets: makePreset', () => {
  it('создаёт снимок с id и ISO-датой', () => {
    const p = makePreset('РРС 0.6 м', 'ground', antenna, radio)
    expect(p.name).toBe('РРС 0.6 м')
    expect(p.station).toBe('ground')
    expect(p.antenna).toEqual(antenna)
    expect(p.radio).toEqual(radio)
    expect(p.id.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(p.createdAt))).toBe(false)
  })

  it('имя обрезается до 80 символов, пустое → «Без имени»', () => {
    expect(makePreset('x'.repeat(120), 'mobile', antenna, radio).name.length).toBe(80)
    expect(makePreset('   ', 'mobile', antenna, radio).name).toBe('Без имени')
  })
})

describe('presets: импорт merge/replace', () => {
  it('merge добавляет новые и пропускает дубликаты (id и имя+станция)', () => {
    const imported: EquipmentPreset[] = [
      { ...preset }, // дубликат по id
      { ...preset, id: 'p2', name: 'Сектор 17 дБи', station: 'ground' }, // дубликат по имя+станция
      { ...preset, id: 'p2', name: 'Другое имя', station: 'ground' }, // новый
      { ...preset, id: 'p3', name: 'Диполь', station: 'mobile' }, // новый
    ]
    const res = mergePresets([preset], imported)
    expect(res.added).toBe(2)
    expect(res.skipped).toBe(2)
    expect(res.list.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('replace полностью заменяет список', () => {
    const res = replacePresets([{ ...preset, id: 'x1' }])
    expect(res.list.map((p) => p.id)).toEqual(['x1'])
    expect(res.added).toBe(1)
  })
})

describe('presets: файл экспорт/импорт', () => {
  it('round-trip сохраняет пресеты', () => {
    const list = [preset, { ...preset, id: 'p2', name: 'Подвижная', station: 'mobile' as const }]
    const parsed = parsePresetsFile(encodePresetsFile(list))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.presets).toEqual(list)
  })

  it('версия файла — 1', () => {
    expect(JSON.parse(encodePresetsFile([preset])).version).toBe(PRESETS_FILE_VERSION)
  })

  it('мусор отклоняется с понятной ошибкой', () => {
    const bad = parsePresetsFile('не json')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('Некорректный JSON')
  })

  it('невалидная структура отклоняется', () => {
    expect(parsePresetsFile('{}').ok).toBe(false)
    expect(parsePresetsFile(JSON.stringify({ version: 2, presets: [] })).ok).toBe(false)
    expect(
      parsePresetsFile(JSON.stringify({ version: 1, presets: [{ ...preset, antenna: { ...antenna, gainDbi: 500 } }] })).ok,
    ).toBe(false)
    expect(
      parsePresetsFile(JSON.stringify({ version: 1, presets: [{ ...preset, radio: { ...radio, powerDbm: 999 } }] })).ok,
    ).toBe(false)
  })
})

describe('presets: localStorage', () => {
  it('сохранение и чтение (если localStorage доступен)', () => {
    if (typeof localStorage === 'undefined') return
    savePresets([preset])
    expect(loadPresets()).toEqual([preset])
    // битое содержимое → пустой список, а не падение
    localStorage.setItem('radio-presets', '{битый')
    expect(loadPresets()).toEqual([])
    localStorage.removeItem('radio-presets')
  })
})
