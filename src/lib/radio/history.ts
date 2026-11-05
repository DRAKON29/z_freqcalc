/**
 * История расчётов — ТЗ 4.9:
 *  • IndexedDB (локально, офлайн);
 *  • синхронизация с Python-сервисом (http-режим);
 *  • привязка к анонимному device_id (без авторизации);
 *  • fallback: только IndexedDB при недоступности сервера.
 */
import type { HistoryEntry } from './types'
import { apiUrl } from './models/api'

const DB_NAME = 'radio-propagation'
const DB_VERSION = 2

export const STORE_HISTORY = 'history'
export const STORE_SRTM = 'srtm'
export const STORE_ITU_MAPS = 'itu_maps'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const store = db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true })
          store.createIndex('deviceId', 'deviceId')
          store.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(STORE_SRTM)) {
          db.createObjectStore(STORE_SRTM, { keyPath: 'name' })
        }
        if (!db.objectStoreNames.contains(STORE_ITU_MAPS)) {
          db.createObjectStore(STORE_ITU_MAPS, { keyPath: 'name' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Анонимный device_id (localStorage, ТЗ 3.4). */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem('radio_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('radio_device_id', id)
  }
  return id
}

/** Сохранение расчёта в историю (IndexedDB). */
export async function saveHistory(entry: Omit<HistoryEntry, 'id' | 'synced'>): Promise<HistoryEntry> {
  const full: HistoryEntry = { ...entry, synced: false }
  const id = await tx<IDBValidKey>(STORE_HISTORY, 'readwrite', (s) => s.add(full))
  return { ...full, id: Number(id) }
}

/** Все записи истории устройства. */
export async function listHistory(deviceId: string): Promise<HistoryEntry[]> {
  const all = await tx<HistoryEntry[]>(STORE_HISTORY, 'readonly', (s) => s.getAll() as IDBRequest<HistoryEntry[]>)
  return all.filter((h) => h.deviceId === deviceId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function clearHistory(deviceId: string): Promise<void> {
  const all = await listHistory(deviceId)
  const db = await openDb()
  const t = db.transaction(STORE_HISTORY, 'readwrite')
  const store = t.objectStore(STORE_HISTORY)
  for (const e of all) {
    if (e.id !== undefined) store.delete(e.id)
  }
}

/** Обновление флага синхронизации. */
export async function markSynced(id: number): Promise<void> {
  const db = await openDb()
  const t = db.transaction(STORE_HISTORY, 'readwrite')
  const store = t.objectStore(STORE_HISTORY)
  const get = store.get(id)
  get.onsuccess = () => {
    const entry = get.result as HistoryEntry | undefined
    if (entry) {
      store.put({ ...entry, synced: true })
    }
  }
}

/** Отправка одной записи на сервер (http-режим). */
export async function syncEntry(entry: HistoryEntry): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/history'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: entry.deviceId, entry }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Синхронизация всех несинхронизированных записей. */
export async function syncPending(deviceId: string): Promise<{ ok: number; fail: number }> {
  const all = await listHistory(deviceId)
  let ok = 0
  let fail = 0
  for (const e of all) {
    if (e.synced || e.id === undefined) continue
    if (await syncEntry(e)) {
      await markSynced(e.id)
      ok++
    } else {
      fail++
    }
  }
  return { ok, fail }
}

/** Загрузка истории с сервера (объединение с локальной). */
export async function fetchServerHistory(deviceId: string): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(apiUrl(`/history?device_id=${encodeURIComponent(deviceId)}`))
    if (!res.ok) return []
    const data = await res.json()
    return (data.entries ?? []) as HistoryEntry[]
  } catch {
    return []
  }
}

/** Кэш тайлов SRTM в IndexedDB (ТЗ 5.2). */
export async function putSrtmTile(name: string, buffer: ArrayBuffer): Promise<void> {
  await tx(STORE_SRTM, 'readwrite', (s) => s.put({ name, buffer }) as unknown as IDBRequest<IDBValidKey>)
}

export async function listSrtmTiles(): Promise<string[]> {
  const all = await tx<{ name: string; buffer: ArrayBuffer }[]>(STORE_SRTM, 'readonly', (s) => s.getAll() as IDBRequest<{ name: string; buffer: ArrayBuffer }[]>)
  return all.map((t) => t.name)
}

export async function getSrtmTile(name: string): Promise<ArrayBuffer | null> {
  const rec = await tx<{ name: string; buffer: ArrayBuffer } | undefined>(STORE_SRTM, 'readonly', (s) => s.get(name) as IDBRequest<{ name: string; buffer: ArrayBuffer } | undefined>)
  return rec?.buffer ?? null
}

/** Кэш карт ITU (wasm-режим, ТЗ 6.2). */
export async function putItuMap(name: string, text: string): Promise<void> {
  await tx(STORE_ITU_MAPS, 'readwrite', (s) => s.put({ name, text }) as unknown as IDBRequest<IDBValidKey>)
}

export async function listItuMaps(): Promise<{ name: string; size: number }[]> {
  const all = await tx<{ name: string; text: string }[]>(STORE_ITU_MAPS, 'readonly', (s) => s.getAll() as IDBRequest<{ name: string; text: string }[]>)
  return all.map((t) => ({ name: t.name, size: t.text.length }))
}
