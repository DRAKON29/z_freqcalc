/**
 * Share-ссылка (этап UX.1, референс antenna.2tg.dev — encodeState/decodeHash):
 * входные параметры расчёта сериализуются в URL-hash, декод выполняется только
 * на клиенте (useEffect на монте страницы — SSR-safe). Формат hash, а не
 * searchParams — роутер Next.js не затрагивается.
 *
 * Сериализуются только входные данные: точки A/Б, частоты (оба режима + диапазоны),
 * поляризация, высоты, k-фактор, климатическая зона, атмосфера, оборудование
 * (base64url-JSON, та же форма, что linkParams в истории), модель.
 * Карты ITU/тайлы SRTM/clutter/файл маршрута НЕ сериализуются — рельеф
 * получатель подтягивает сам (fetchMissingSrtmTiles внутри calculate).
 */
import { z } from 'zod'
import type { EquipmentParams, ModelId, Polarization } from './types'
import { equipmentParamsSchema } from './validation'
import { LIMITS } from './constants'

/** Состояние, сериализуемое в share-ссылку (подмножество RadioState). */
export interface ShareSource {
  pointA: { lat: number; lon: number }
  pointB: { lat: number; lon: number }
  frequencyMhz: number
  frequencyMode: 'single' | 'range'
  freqFromMhz: number
  freqToMhz: number
  mobileFrequencyMhz: number
  mobileFrequencyMode: 'single' | 'range'
  mobileFreqFromMhz: number
  mobileFreqToMhz: number
  polarization: Polarization
  txHeightM: number
  rxHeightM: number
  kFactor: number
  climateZone: string
  atmosphere: { rainRateMmH?: number; gases: boolean; vegetation: boolean }
  equipment: EquipmentParams
  model: ModelId
}

/** Частично декодированный стейт: присутствуют только валидные поля hash. */
export type ShareState = Partial<ShareSource> & { run?: boolean }

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

/** ---------- base64url (безопасно для URL, Unicode через TextEncoder) ---------- */

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** ---------- Кодирование ---------- */

const num = (v: number, digits = 2) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '')

/**
 * Сериализация состояния в hash-строку (без ведущего '#').
 * Точки присутствуют всегда (конвенция store) — run=1 всегда включён:
 * открытие ссылки воспроизводит расчёт, как в референсе.
 */
export function encodeShareHash(s: ShareSource): string {
  const p = new URLSearchParams()
  p.set('a', `${s.pointA.lat.toFixed(6)},${s.pointA.lon.toFixed(6)}`)
  p.set('b', `${s.pointB.lat.toFixed(6)},${s.pointB.lon.toFixed(6)}`)
  p.set('f', num(s.frequencyMhz, 2))
  p.set('fm', s.frequencyMode === 'range' ? 'r' : 's')
  if (s.frequencyMode === 'range') {
    p.set('f1', num(s.freqFromMhz, 2))
    p.set('f2', num(s.freqToMhz, 2))
  }
  p.set('mf', num(s.mobileFrequencyMhz, 2))
  p.set('mfm', s.mobileFrequencyMode === 'range' ? 'r' : 's')
  if (s.mobileFrequencyMode === 'range') {
    p.set('mf1', num(s.mobileFreqFromMhz, 2))
    p.set('mf2', num(s.mobileFreqToMhz, 2))
  }
  p.set('pol', s.polarization === 'vertical' ? 'v' : s.polarization === 'horizontal' ? 'h' : 'c')
  p.set('htx', num(s.txHeightM, 1))
  p.set('hrx', num(s.rxHeightM, 1))
  p.set('k', num(s.kFactor, 3))
  p.set('cz', s.climateZone)
  if (s.atmosphere.rainRateMmH !== undefined && s.atmosphere.rainRateMmH > 0) p.set('rn', num(s.atmosphere.rainRateMmH, 1))
  if (s.atmosphere.gases) p.set('gs', '1')
  if (s.atmosphere.vegetation) p.set('vg', '1')
  p.set('eq', toBase64Url(JSON.stringify(s.equipment)))
  p.set('md', s.model)
  p.set('run', '1')
  return p.toString()
}

/** ---------- Декодирование (tolerant: невалидное поле игнорируется) ---------- */

function parseNum(v: string | null, min: number, max: number): number | undefined {
  if (v === null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return undefined
  return n
}

function parsePoint(v: string | null): { lat: number; lon: number } | undefined {
  if (v === null) return undefined
  const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (!m) return undefined
  const parsed = pointSchema.safeParse({ lat: Number(m[1]), lon: Number(m[2]) })
  return parsed.success ? parsed.data : undefined
}

function parseMode(v: string | null): 'single' | 'range' | undefined {
  if (v === 's') return 'single'
  if (v === 'r') return 'range'
  return undefined
}

function parsePol(v: string | null): Polarization | undefined {
  if (v === 'v') return 'vertical'
  if (v === 'h') return 'horizontal'
  if (v === 'c') return 'circular'
  return undefined
}

/**
 * Декод hash-строки (без ведущего '#'). Обязательны только точки A и Б —
 * если их нет или они невалидны, возвращается null (ссылка не применяется).
 * Остальные поля толерантны: невалидное значение игнорируется, поле просто
 * отсутствует в результате (applyShareState его не трогает).
 */
export function decodeShareHash(hash: string): ShareState | null {
  if (!hash) return null
  const p = new URLSearchParams(hash)
  const pointA = parsePoint(p.get('a'))
  const pointB = parsePoint(p.get('b'))
  if (!pointA || !pointB) return null

  const out: ShareState = { pointA, pointB }

  // Частоты — в пределах рабочего диапазона калькулятора (иначе расчёт
  // не пройдёт валидацию): невалидная частота игнорируется целиком
  const freqRange = (v: string | null): number | undefined => parseNum(v, LIMITS.frequencyMinMhz, LIMITS.frequencyMaxMhz)
  const f = freqRange(p.get('f'))
  if (f !== undefined) out.frequencyMhz = f
  const fm = parseMode(p.get('fm'))
  if (fm !== undefined) out.frequencyMode = fm
  const f1 = freqRange(p.get('f1'))
  if (f1 !== undefined) out.freqFromMhz = f1
  const f2 = freqRange(p.get('f2'))
  if (f2 !== undefined) out.freqToMhz = f2
  const mf = freqRange(p.get('mf'))
  if (mf !== undefined) out.mobileFrequencyMhz = mf
  const mfm = parseMode(p.get('mfm'))
  if (mfm !== undefined) out.mobileFrequencyMode = mfm
  const mf1 = freqRange(p.get('mf1'))
  if (mf1 !== undefined) out.mobileFreqFromMhz = mf1
  const mf2 = freqRange(p.get('mf2'))
  if (mf2 !== undefined) out.mobileFreqToMhz = mf2

  const pol = parsePol(p.get('pol'))
  if (pol !== undefined) out.polarization = pol
  const htx = parseNum(p.get('htx'), 0.5, 5000)
  if (htx !== undefined) out.txHeightM = htx
  const hrx = parseNum(p.get('hrx'), 0.5, 5000)
  if (hrx !== undefined) out.rxHeightM = hrx
  const k = parseNum(p.get('k'), 0.5, 10)
  if (k !== undefined) out.kFactor = k
  const cz = p.get('cz')
  if (cz && cz.length <= 2) out.climateZone = cz

  const rn = parseNum(p.get('rn'), 0, 150)
  const gs = p.get('gs') === '1'
  const vg = p.get('vg') === '1'
  if (rn !== undefined || gs || vg) {
    out.atmosphere = {
      ...(rn !== undefined ? { rainRateMmH: rn } : {}),
      gases: gs,
      vegetation: vg,
    }
  }

  const eqRaw = p.get('eq')
  if (eqRaw) {
    try {
      const obj: unknown = JSON.parse(fromBase64Url(eqRaw))
      const eq = equipmentParamsSchema.safeParse(obj)
      if (eq.success) out.equipment = eq.data as EquipmentParams
    } catch {
      // битый equipment — поле игнорируется
    }
  }
  const md = p.get('md')
  if (md === 'p2001' || md === 'fspl-p526' || md === 'itm') out.model = md

  out.run = p.get('run') === '1'
  return out
}
