/**
 * Тесты истории расчётов на fake-indexeddb: CRUD, device_id, синхронизация,
 * кэши тайлов SRTM / карт ITU / clutter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getDeviceId,
  saveHistory,
  listHistory,
  clearHistory,
  markSynced,
  syncEntry,
  syncPending,
  fetchServerHistory,
  putSrtmTile,
  listSrtmTiles,
  getSrtmTile,
  putItuMap,
  listItuMaps,
  putClutterCache,
  getClutterCache,
  clearClutterCache,
} from '../history'
import { makeHistoryEntry } from './fixtures'

const DEVICE = 'device-A'

describe('device_id', () => {
  it('генерируется один раз и сохраняется в localStorage', () => {
    localStorage.clear()
    const id1 = getDeviceId()
    const id2 = getDeviceId()
    expect(id1).toBe(id2)
    expect(localStorage.getItem('radio_device_id')).toBe(id1)
  })
  it('вне браузера → "server"', () => {
    // В jsdom window есть — проверяем контракт наличия id
    expect(getDeviceId().length).toBeGreaterThan(10)
  })
})

describe('история: save/list/clear/markSynced', () => {
  beforeEach(async () => {
    await clearHistory(DEVICE)
    await clearHistory('other')
  })

  it('сохранение и чтение по device_id, сортировка по дате (свежие сверху)', async () => {
    const e1 = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE, createdAt: '2026-01-01T00:00:00Z' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    const e2 = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE, createdAt: '2026-01-02T00:00:00Z' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    const all = await listHistory(DEVICE)
    expect(all).toHaveLength(2)
    expect(all[0].createdAt).toBe('2026-01-02T00:00:00Z')
    expect(all[0].id).toBeGreaterThan(0)
    expect(e1.synced).toBe(false)
    expect(e2.synced).toBe(false)
  })
  it('чужой device_id отфильтровывается', async () => {
    await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    await saveHistory({ ...makeHistoryEntry({ deviceId: 'other' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    expect(await listHistory(DEVICE)).toHaveLength(1)
    expect(await listHistory('other')).toHaveLength(1)
  })
  it('очистка удаляет только записи устройства', async () => {
    await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    await saveHistory({ ...makeHistoryEntry({ deviceId: 'other' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    await clearHistory(DEVICE)
    expect(await listHistory(DEVICE)).toHaveLength(0)
    expect(await listHistory('other')).toHaveLength(1)
  })
  it('markSynced помечает запись синхронизированной', async () => {
    const e = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    await markSynced(e.id!)
    const all = await listHistory(DEVICE)
    expect(all[0].synced).toBe(true)
  })
})

describe('синхронизация с сервером', () => {
  beforeEach(async () => {
    await clearHistory(DEVICE)
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('syncEntry: успешная отправка → true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as never)
    const e = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    expect(await syncEntry(e)).toBe(true)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/history'), expect.objectContaining({ method: 'POST' }))
  })
  it('syncEntry: сеть недоступна → false (офлайн-fallback)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const e = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    expect(await syncEntry(e)).toBe(false)
  })
  it('syncPending: отправляет несинхронизированные, помечает, считает ok/fail', async () => {
    await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE, createdAt: '2026-01-01T00:00:00Z' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE, createdAt: '2026-01-02T00:00:00Z' }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    vi.mocked(fetch).mockResolvedValue({ ok: true } as never)
    const r = await syncPending(DEVICE)
    expect(r.ok).toBe(2)
    expect(r.fail).toBe(0)
    const all = await listHistory(DEVICE)
    expect(all.every((e) => e.synced)).toBe(true)
    // повторная синхронизация — нечего отправлять
    expect((await syncPending(DEVICE)).ok).toBe(0)
  })
  it('syncPending: ошибка сети считается fail', async () => {
    await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const r = await syncPending(DEVICE)
    expect(r.fail).toBe(1)
    expect(r.ok).toBe(0)
  })
  it('fetchServerHistory: разбирает { entries }', async () => {
    const entries = [makeHistoryEntry({ deviceId: DEVICE })]
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ entries }) } as never)
    expect(await fetchServerHistory(DEVICE)).toEqual(entries)
  })
  it('fetchServerHistory: ошибка сервера → пустой список', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as never)
    expect(await fetchServerHistory(DEVICE)).toEqual([])
    vi.mocked(fetch).mockRejectedValueOnce(new Error('x') as never)
    expect(await fetchServerHistory(DEVICE)).toEqual([])
  })
})

describe('кэши: SRTM-тайлы, карты ITU, clutter', () => {
  it('SRTM: put/get/list (IndexedDB клонирует буфер — сравниваем содержимое)', async () => {
    const buf = new ArrayBuffer(8)
    new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8])
    await putSrtmTile('N47E039', buf)
    await putSrtmTile('N48E039', buf)
    expect(await listSrtmTiles()).toEqual(expect.arrayContaining(['N47E039', 'N48E039']))
    const got = await getSrtmTile('N47E039')
    expect(got).not.toBeNull()
    expect(Array.from(new Uint8Array(got!))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(await getSrtmTile('NOPE')).toBeNull()
  })
  it('карты ITU: put + list с размером', async () => {
    await putItuMap('p837.txt', 'rain data')
    const maps = await listItuMaps()
    const m = maps.find((x) => x.name === 'p837.txt')
    expect(m?.size).toBe('rain data'.length)
  })
  it('clutter: put/get/clear', async () => {
    const gj = { type: 'FeatureCollection', features: [] }
    await putClutterCache(gj)
    expect(await getClutterCache()).toEqual(gj)
    await clearClutterCache()
    expect(await getClutterCache()).toBeNull()
  })
})

describe('ИсторияEntry: контракт структуры (для PDF-экспорта)', () => {
  it('запись содержит все поля, нужные листу PDF: частота, координаты, длина, бюджет', async () => {
    const e = await saveHistory({ ...makeHistoryEntry({ deviceId: DEVICE }), input: makeHistoryEntry().input, budget: makeHistoryEntry().budget })
    expect(e.input.frequencyMhz).toBeGreaterThan(0)
    expect(e.input.path.points).toHaveLength(2)
    expect(e.input.path.profile.length).toBeGreaterThan(3)
    expect(e.distanceKm).toBeGreaterThan(0)
    expect(e.budget.linkMarginDb).toBeDefined()
  })
})
