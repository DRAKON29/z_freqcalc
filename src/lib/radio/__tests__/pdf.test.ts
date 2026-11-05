/**
 * Тесты PDF-экспорта истории (jsPDF): сборка Blob'а со шрифтами из public/fonts,
 * по листу на расчёт, содержащему основные данные расчёта, профиль и бюджет.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { historyEntriesToPdfBlob } from '../pdf'
import { makeHistoryEntry } from './fixtures'

// jsPDF тянет шрифты fetch'ем — подменяем на чтение из public/fonts с диска
beforeAll(() => {
  const fontDir = path.resolve(process.cwd(), 'public/fonts')
  const normal = readFileSync(path.join(fontDir, 'DejaVuSans.ttf'))
  const bold = readFileSync(path.join(fontDir, 'DejaVuSans-Bold.ttf'))
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = url.includes('Bold') ? bold : normal
    return Promise.resolve({ ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) })
  }))
})
afterEach(() => {
  vi.mocked(fetch).mockClear()
})

describe('historyEntriesToPdfBlob', () => {
  it('одна запись → PDF-блоб ненулевого размера с кириллицей', async () => {
    const blob = await historyEntriesToPdfBlob([makeHistoryEntry()])
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toContain('pdf')
    expect(blob.size).toBeGreaterThan(20_000) // встроенные шрифты + содержимое
  })
  it('несколько записей → документ крупнее, чем для одной (лист на расчёт)', async () => {
    const entries = [
      makeHistoryEntry(),
      makeHistoryEntry({ createdAt: '2026-02-01T08:00:00Z', name: 'Вторая трасса' }),
    ]
    const [one, two] = await Promise.all([
      historyEntriesToPdfBlob([entries[0]]),
      historyEntriesToPdfBlob(entries),
    ])
    expect(two.size).toBeGreaterThan(one.size)
  })
  it('запись с отрицательным запасом тоже экспортируется (связь не обеспечена)', async () => {
    const entry = makeHistoryEntry({ linkMarginDb: -8.4 })
    entry.budget = { ...entry.budget, linkMarginDb: -8.4 }
    const blob = await historyEntriesToPdfBlob([entry])
    expect(blob.size).toBeGreaterThan(20_000)
  })
  it('горный профиль (нелинейный рельеф) отрисовывается без ошибок', async () => {
    const entry = makeHistoryEntry()
    const n = entry.input.path.profile.length
    entry.input.path.profile = entry.input.path.profile.map((p, i) => ({
      ...p,
      elev: Math.round(120 * Math.sin((i / n) * Math.PI * 3) + 60),
    }))
    const blob = await historyEntriesToPdfBlob([entry])
    expect(blob.size).toBeGreaterThan(20_000)
  })
  it('шрифты грузятся один раз (кэш промиса), повторный вызов без fetch', async () => {
    await historyEntriesToPdfBlob([makeHistoryEntry()])
    const callsAfterFirst = vi.mocked(fetch).mock.calls.length
    await historyEntriesToPdfBlob([makeHistoryEntry()])
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterFirst)
  })
})
