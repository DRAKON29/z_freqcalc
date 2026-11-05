/**
 * Тесты экспорта JSON/CSV и скачивания.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildExportPayload, toJson, toCsv, historyToCsv, download } from '../export'
import { computeFsplP526 } from '../p2001lite'
import { computeLinkBudget } from '../budget'
import { makeInput, makeEquipment, makeHistoryEntry } from './fixtures'

describe('buildExportPayload', () => {
  it('содержит входные данные, потери и бюджет', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const budget = computeLinkBudget(input, makeEquipment(), prop)
    const payload = buildExportPayload(input, prop, budget)
    expect(payload.input.frequencyMhz).toBe(2000)
    expect(payload.input.distanceKm).toBeCloseTo(input.path.distanceM / 1000, 3)
    expect(payload.propagation.model).toBe('fspl-p526')
    expect(payload.budget.linkMarginDb).toBe(budget.linkMarginDb)
    expect(payload.dynamics).toBeUndefined()
  })
  it('generatedAt — валидный ISO', () => {
    const payload = buildExportPayload(makeInput(), computeFsplP526(makeInput()), computeLinkBudget(makeInput(), makeEquipment(), computeFsplP526(makeInput())))
    expect(Number.isNaN(Date.parse(payload.generatedAt))).toBe(false)
  })
  it('профиль округляется до 0.1 м', () => {
    const input = makeInput()
    input.path.profile = [{ d: 1234.567, elev: 100.555, clutter: 0, total: 100.555 }]
    const payload = buildExportPayload(input, computeFsplP526(input), computeLinkBudget(input, makeEquipment(), computeFsplP526(input)))
    expect(payload.input.profile[0].d).toBe(1234.6)
    expect(payload.input.profile[0].elev).toBe(100.555)
  })
})

describe('toJson / toCsv', () => {
  it('toJson — человекочитаемый JSON', () => {
    expect(toJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
  it('toCsv — разделитель «;», секции вход/потери/бюджет/профиль', () => {
    const input = makeInput()
    const prop = computeFsplP526(input)
    const budget = computeLinkBudget(input, makeEquipment(), prop)
    const csv = toCsv(buildExportPayload(input, prop, budget) as never)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Секция;Параметр;Значение')
    expect(csv).toContain('Вход;"Частота, МГц";2000')
    expect(csv).toContain("Бюджет;\"EIRP, дБм\";40.00")
    expect(csv).toContain("Бюджет;\"Link margin, дБ\";")
    expect(csv).toContain('Профиль;d=0 м')
  })
  it('toCsv экранирует запятые и кавычки', () => {
    const payload = {
      input: { profile: [] },
      propagation: { byTimePercent: [], medianLossDb: 0 } as never,
      budget: {
        eirpDbm: 40,
        prxDbm: -85,
        snrDb: 20,
        linkMarginDb: 10.5,
      } as never,
    }
    const csv = toCsv(payload as never)
    expect(csv).toContain('10.50')
  })
})

describe('historyToCsv', () => {
  it('заголовок и по строке на запись', () => {
    const e1 = makeHistoryEntry()
    const e2 = makeHistoryEntry({ createdAt: '2026-01-16T12:00:00.000Z', name: 'Запись, с запятой' })
    const csv = historyToCsv([e1, e2])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Дата;Название;Модель')
    expect(lines[2]).toContain('"Запись, с запятой"')
  })
  it('пустая история → только заголовок', () => {
    expect(historyToCsv([]).split('\n')).toHaveLength(1)
  })
})

describe('download()', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
  })
  it('создаёт Blob и кликает по ссылке', () => {
    const click = vi.fn()
    const append = vi.fn()
    const remove = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        ({
          click,
          set href(v: string) {},
          set download(v: string) {},
        }) as unknown as HTMLElement,
    )
    vi.spyOn(document.body, 'appendChild').mockImplementation(append as never)
    vi.spyOn(document.body, 'removeChild').mockImplementation(remove as never)

    download('test.json', '{}', 'application/json')
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
