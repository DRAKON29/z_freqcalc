/**
 * Пользовательские пресеты оборудования (этап UX.2): пресеты создаёт сам
 * пользователь из карточки станции («Сохранить пресет как…» — модальное окно
 * с вводом имени), применяются к любой станции. Встроенного каталога нет.
 *
 * Хранение — localStorage. Импорт/экспорт JSON-файла — вкладка
 * «Карты и настройки» (секция «Пресеты оборудования»): два режима импорта —
 * «добавить к существующим» / «переписать существующие» (с предупреждением
 * о безвозвратной перезаписи).
 */
import { z } from 'zod'
import { antennaParamsSchema, transceiverParamsSchema } from './validation'
import type { AntennaParams, TransceiverParams } from './types'

export interface EquipmentPreset {
  id: string
  name: string
  /** Станция, из карточки которой сохранён пресет (информационно) */
  station: 'ground' | 'mobile'
  /** Момент сохранения, ISO */
  createdAt: string
  /** Снимок антенны станции */
  antenna: AntennaParams
  /** Снимок приёмопередатчика станции */
  radio: TransceiverParams
}

export const PRESETS_STORAGE_KEY = 'radio-presets'
export const PRESETS_FILE_VERSION = 1
/** Лимит числа пресетов (и в хранилище, и в импортируемом файле). */
export const PRESETS_MAX = 200

const presetSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  station: z.enum(['ground', 'mobile']),
  createdAt: z.string().min(1).max(40),
  antenna: antennaParamsSchema,
  radio: transceiverParamsSchema,
})

/** Файл/хранилище пресетов: { version: 1, presets: [...] }. */
const presetsFileSchema = z.object({
  version: z.literal(PRESETS_FILE_VERSION),
  presets: z.array(presetSchema).max(PRESETS_MAX, `Не более ${PRESETS_MAX} пресетов`),
})

/** Новый пресет из снимка станции (имя обрезается до 80 символов). */
export function makePreset(
  name: string,
  station: 'ground' | 'mobile',
  antenna: AntennaParams,
  radio: TransceiverParams,
): EquipmentPreset {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `p${Date.now()}-${Math.round(Math.random() * 1e9)}`
  return {
    id,
    name: name.trim().slice(0, 80) || 'Без имени',
    station,
    createdAt: new Date().toISOString(),
    antenna: { ...antenna },
    radio: { ...radio },
  }
}

/**
 * Режим «добавить к существующим»: импортированные пресеты дописываются к списку;
 * дубликаты (совпадение по id или по паре имя+станция) пропускаются.
 */
export function mergePresets(
  existing: EquipmentPreset[],
  imported: EquipmentPreset[],
): { list: EquipmentPreset[]; added: number; skipped: number } {
  const list = [...existing]
  let added = 0
  let skipped = 0
  for (const p of imported) {
    const dup = list.some((e) => e.id === p.id) || list.some((e) => e.name === p.name && e.station === p.station)
    if (dup) {
      skipped++
      continue
    }
    list.push(p)
    added++
  }
  return { list: list.slice(0, PRESETS_MAX), added, skipped }
}

/** Режим «переписать существующие»: список полностью заменяется импортированным. */
export function replacePresets(imported: EquipmentPreset[]): {
  list: EquipmentPreset[]
  added: number
  skipped: number
} {
  const list = imported.slice(0, PRESETS_MAX)
  return { list, added: list.length, skipped: 0 }
}

/** Экспорт в JSON-строку файла пресетов. */
export function encodePresetsFile(presets: EquipmentPreset[]): string {
  return JSON.stringify({ version: PRESETS_FILE_VERSION, presets }, null, 2)
}

/**
 * Разбор файла пресетов: строгая проверка структуры и пределов полей;
 * при ошибке — понятное сообщение (файл целиком отклоняется).
 */
export function parsePresetsFile(text: string): { ok: true; presets: EquipmentPreset[] } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Некорректный JSON: ${e instanceof Error ? e.message : e}` }
  }
  const parsed = presetsFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? issue.path.join('.') : 'файл'
    return { ok: false, error: `Файл пресетов не прошёл проверку (${where})${issue ? `: ${issue.message}` : ''}` }
  }
  return { ok: true, presets: parsed.data.presets as EquipmentPreset[] }
}

/** Чтение пресетов из localStorage: пусто/ошибка → []. Битые записи отбрасываются. */
export function loadPresets(): EquipmentPreset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = presetsFileSchema.safeParse({ version: PRESETS_FILE_VERSION, presets: JSON.parse(raw) })
    return parsed.success ? (parsed.data.presets as EquipmentPreset[]) : []
  } catch {
    return []
  }
}

/** Сохранение списка в localStorage (тихо при недоступности — пресеты остаются в памяти). */
export function savePresets(list: EquipmentPreset[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // private mode / переполнение — не критично
  }
}
