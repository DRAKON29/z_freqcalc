/**
 * Цифровые продукты ITU-R P.2001-6 (Table 3 рекомендации, файл README_P2001-6.docx):
 *  • реестр файлов с параметрами сетки (первая строка/столбец, шаг, размер);
 *  • парсер текстовых сеток с строгой валидацией размеров и чисел;
 *  • билинейная интерполяция по P.1144 (4 ближайших узла, обёртка долготы 360°);
 *  • TropoClim.txt — целочисленные климатические зоны: ближайший узел,
 *    сетка со сдвигом на полпикселя (89.75°N…−89.75°S, −179.75°E…179.75°E).
 *
 * Параметр в произвольной точке получается интерполяцией по четырём ближайшим
 * узлам сетки (P.1144). Для TropoClim интерполяция запрещена README —
 * берётся значение ближайшего узла.
 */

export interface ItuGridSpec {
  /** Имя файла из Table 3 (сопоставление без учёта регистра). */
  name: string
  /** Раздел рекомендации (например «§ 3.4.1»). */
  ref: string
  /** Рекомендация-источник (например «P.2001»). */
  origin: string
  /** Широта первой строки, °N. */
  lat0: number
  /** Шаг по широте (вниз), градусы. */
  dLat: number
  /** Число строк. */
  rows: number
  /** Долгота первого столбца, °E. */
  lon0: number
  /** Шаг по долготе (вправо), градусы. */
  dLon: number
  /** Число столбцов. */
  cols: number
  /** true — TropoClim: целые зоны, ближайший узел, сетка со сдвигом на полпикселя. */
  zoneBased?: boolean
}

/** Реестр цифровых продуктов Table 3 рекомендации ITU-R P.2001-6. */
export const ITU_GRID_SPECS: readonly ItuGridSpec[] = [
  { name: 'DN_Median.txt', ref: '§ 3.4.1', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'DN_SupSlope.txt', ref: '§ 3.4.1', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'DN_SubSlope.txt', ref: '§ 3.4.1', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'dndz_01.txt', ref: '§ 3.4.2', origin: 'P.453-10', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'Esarain_Pr6_v5.txt', ref: '§ C.2', origin: 'P.837-5', lat0: 90, dLat: 1.125, rows: 161, lon0: 0, dLon: 1.125, cols: 321 },
  { name: 'Esarain_Mt_v5.txt', ref: '§ C.2', origin: 'P.837-5', lat0: 90, dLat: 1.125, rows: 161, lon0: 0, dLon: 1.125, cols: 321 },
  { name: 'Esarain_Beta_v5.txt', ref: '§ C.2', origin: 'P.837-5', lat0: 90, dLat: 1.125, rows: 161, lon0: 0, dLon: 1.125, cols: 321 },
  { name: 'h0.txt', ref: '§ C.2', origin: 'P.839-4', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'Surfwv_50_fixed.txt', ref: 'Att F', origin: 'P.836-4 (corrected)', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'FoEs50.txt', ref: 'Att G', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'FoEs10.txt', ref: 'Att G', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'FoEs01.txt', ref: 'Att G', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'FoEs0.1.txt', ref: 'Att G', origin: 'P.2001', lat0: 90, dLat: 1.5, rows: 121, lon0: 0, dLon: 1.5, cols: 241 },
  { name: 'TropoClim.txt', ref: 'Att E', origin: 'P.2001', lat0: 89.75, dLat: 0.5, rows: 360, lon0: -179.75, dLon: 0.5, cols: 720, zoneBased: true },
]

/** Поиск спецификации по имени файла (регистр не важен). */
export function findItuGridSpec(name: string): ItuGridSpec | undefined {
  const base = name.trim().toLowerCase()
  return ITU_GRID_SPECS.find((s) => s.name.toLowerCase() === base)
}

export class ItuGridParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItuGridParseError'
  }
}

export interface ItuGrid {
  spec: ItuGridSpec
  rows: number
  cols: number
  /** Значения [строка][столбец], строка 0 — самая северная (lat0). */
  values: number[][]
}

/**
 * Парсер текстовой сетки ITU: строки с числами, разделёнными пробелами.
 * Строго проверяет число строк/столбцов по спецификации и конечность значений.
 */
export function parseItuGridText(text: string, spec: ItuGridSpec): ItuGrid {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length !== spec.rows) {
    throw new ItuGridParseError(
      `${spec.name}: ожидается ${spec.rows} строк, получено ${lines.length}`,
    )
  }
  const values: number[][] = []
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].trim().split(/\s+/)
    if (tokens.length !== spec.cols) {
      throw new ItuGridParseError(
        `${spec.name}: строка ${i + 1}: ожидается ${spec.cols} столбцов, получено ${tokens.length}`,
      )
    }
    const row: number[] = new Array(spec.cols)
    for (let j = 0; j < tokens.length; j++) {
      const v = Number(tokens[j])
      if (!Number.isFinite(v)) {
        throw new ItuGridParseError(
          `${spec.name}: строка ${i + 1}, столбец ${j + 1}: нечисловое значение «${tokens[j]}»`,
        )
      }
      row[j] = v
    }
    values.push(row)
  }
  return { spec, rows: spec.rows, cols: spec.cols, values }
}

/** Парсер по имени файла: спецификация берётся из реестра Table 3. */
export function parseItuGrid(name: string, text: string): ItuGrid {
  const spec = findItuGridSpec(name)
  if (!spec) {
    throw new ItuGridParseError(
      `${name}: файл не входит в перечень цифровых продуктов ITU-R P.2001-6 (Table 3)`,
    )
  }
  return parseItuGridText(text, spec)
}

function mod(x: number, m: number): number {
  return ((x % m) + m) % m
}

/**
 * Билинейная интерполяция по P.1144 (4 ближайших узла).
 * Широта зажимается в диапазон сетки; долгота — обёртка по полному охвату
 * (последний столбец стандартных продуктов дублирует первый: 360° ≡ 0°).
 */
export function bilinearItu(grid: ItuGrid, lat: number, lon: number): number {
  const s = grid.spec
  if (s.zoneBased) return nearestZoneItu(grid, lat, lon)

  const latMin = s.lat0 - (s.rows - 1) * s.dLat
  const latC = Math.min(Math.max(lat, latMin), s.lat0)
  const fi = (s.lat0 - latC) / s.dLat
  const i0 = s.rows > 1 ? Math.min(Math.floor(fi), s.rows - 2) : 0
  const di = fi - i0

  const spanLon = (s.cols - 1) * s.dLon
  // Дробный индекс столбца: без обёртки, пока точка внутри диапазона сетки
  // (включая последний столбец — у стандартных продуктов он дублирует первый).
  // Обёртка по 360° применяется только для точек вне диапазона (по P.1144).
  let fj = (lon - s.lon0) / s.dLon
  if (fj < 0 || fj > s.cols - 1) {
    fj = mod(lon - s.lon0, spanLon) / s.dLon
  }
  const j0 = s.cols > 1 ? Math.min(Math.max(Math.floor(fj), 0), s.cols - 2) : 0
  const dj = fj - j0

  const v00 = grid.values[i0][j0]
  const v10 = grid.values[i0 + 1][j0]
  const v01 = grid.values[i0][j0 + 1]
  const v11 = grid.values[i0 + 1][j0 + 1]
  return v00 * (1 - di) * (1 - dj) + v10 * di * (1 - dj) + v01 * (1 - di) * dj + v11 * di * dj
}

/**
 * Ближайший узел (для TropoClim): целочисленные зоны интерполировать нельзя.
 * Центры узлов со сдвигом на полпикселя: строка i → 89.75° − i·0.5°,
 * столбец j → −179.75° + j·0.5°.
 */
export function nearestZoneItu(grid: ItuGrid, lat: number, lon: number): number {
  const s = grid.spec
  const i = Math.min(Math.max(Math.round((s.lat0 - lat) / s.dLat), 0), s.rows - 1)
  const lonMax = s.lon0 + (s.cols - 1) * s.dLon
  const lonC = Math.min(Math.max(lon, s.lon0), lonMax)
  const j = Math.min(Math.max(Math.round((lonC - s.lon0) / s.dLon), 0), s.cols - 1)
  return grid.values[i][j]
}

/** Единая точка входа: билинейная (P.1144) или ближайший узел (TropoClim). */
export function interpolateItu(grid: ItuGrid, lat: number, lon: number): number {
  return grid.spec.zoneBased ? nearestZoneItu(grid, lat, lon) : bilinearItu(grid, lat, lon)
}

export interface ItuFileValidation {
  ok: boolean
  error?: string
  /** Человекочитаемое описание распознанной сетки (для известных продуктов). */
  info?: string
}

/**
 * Валидация загружаемого файла карт ITU:
 *  • известный продукт Table 3 → строгая проверка сетки;
 *  • неизвестное имя → принимается без проверки (произвольные данные).
 */
export function validateItuFile(name: string, text: string): ItuFileValidation {
  const spec = findItuGridSpec(name)
  if (!spec) return { ok: true }
  try {
    const grid = parseItuGridText(text, spec)
    return {
      ok: true,
      info: `ITU-R ${spec.origin} ${spec.ref}: сетка ${grid.rows}×${grid.cols}, шаг ${spec.dLat}°×${spec.dLon}°, первая строка ${spec.lat0}°N`,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
