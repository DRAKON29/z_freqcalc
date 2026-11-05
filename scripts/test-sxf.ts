/**
 * Быстрая проверка новой логики: парсер SXF, квадраты, слияние clutter,
 * список частот диапазона, конверсия СК-42.
 * Запуск: bun scripts/test-sxf.ts
 */
import { parseSxf, convertSxfToClutter, mergeClutter, parseSquaresList } from '../src/lib/radio/sxf'
import { sk42ToWgs84, wgs84ToSk42 } from '../src/lib/radio/coordinates'

// --- Синтетический SXF: паспорт 1024 байта + 2 записи (площадной лес + линия) ---
function buildSyntheticSxf(): ArrayBuffer {
  const buf = new ArrayBuffer(2048)
  const dv = new DataView(buf)
  // Сигнатура 0x00304453 (LE)
  dv.setUint32(0x00, 0x00304453, true)
  dv.setInt32(0x04, 4, true) // версия
  dv.setInt32(0x08, 1, true) // Гаусс-Крюгер
  dv.setInt32(0x38, 100000, true) // масштаб

  // Зона 7 (Московская область): x ~ 6183000 м, y = 7 000 000 + 413 000
  // Запись 1: площадной объект, код 20 (лес), 5 точек
  const rec1 = new Uint8Array(32 + 5 * 8 + 16 + 4 * 8) // заголовок + точки + подобъект
  const dv1 = new DataView(rec1.buffer)
  dv1.setInt32(0, rec1.length, true) // длина записи
  dv1.setInt16(4, 1, true) // локализация
  dv1.setInt32(8, 20, true) // код объекта
  dv1.setInt32(12, 100000, true) // масштаб
  dv1.setInt16(16, 1, true) // площадная метрика
  dv1.setInt16(18, 1, true) // 1 подобъект
  dv1.setInt32(20, 5, true) // точек
  dv1.setInt16(24, 8, true) // размер точки
  const pts1: Array<[number, number]> = [
    [6183500, 7413500],
    [6183600, 7413500],
    [6183600, 7413600],
    [6183500, 7413600],
    [6183500, 7413500],
  ]
  pts1.forEach(([x, y], i) => {
    dv1.setInt32(32 + i * 8, x, true)
    dv1.setInt32(36 + i * 8, y, true)
  })
  // Подобъект: заголовок 16 байт + 4 точки (замкнутый контур)
  const subPts: Array<[number, number]> = [
    [6183510, 7413510],
    [6183520, 7413510],
    [6183520, 7413520],
    [6183510, 7413510],
  ]
  dv1.setInt32(32 + 5 * 8, 16 + subPts.length * 8, true) // длина подобъекта
  dv1.setInt16(32 + 5 * 8 + 4, 0, true)
  dv1.setInt32(32 + 5 * 8 + 8, subPts.length, true) // точек
  dv1.setInt16(32 + 5 * 8 + 12, 8, true)
  subPts.forEach(([x, y], i) => {
    dv1.setInt32(32 + 5 * 8 + 16 + i * 8, x, true)
    dv1.setInt32(32 + 5 * 8 + 20 + i * 8, y, true)
  })

  new Uint8Array(buf).set(rec1, 1024)

  // Запись 2: точечный объект (код 12) — должен быть пропущен
  const rec2 = new Uint8Array(32 + 1 * 8)
  const dv2 = new DataView(rec2.buffer)
  dv2.setInt32(0, rec2.length, true)
  dv2.setInt32(8, 12, true)
  dv2.setInt16(16, 2, true) // точечная
  dv2.setInt16(18, 0, true)
  dv2.setInt32(20, 1, true)
  dv2.setInt16(24, 8, true)
  dv2.setInt32(32, 6183700, true)
  dv2.setInt32(36, 7413700, true)
  new Uint8Array(buf).set(rec2, 1024 + rec1.length)

  return buf
}

const parsed = parseSxf(buildSyntheticSxf())
console.log('passport:', parsed.passport)
console.log('objects:', parsed.objects.length, parsed.objects.map((o) => ({ code: o.code, mt: o.metricType, contours: o.contours.length })))
if (parsed.objects.length !== 2) throw new Error('ожидается 2 объекта')

// Конверсия без фильтра квадратов
const resAll = convertSxfToClutter(parsed, { squares: '' })
console.log('all:', { total: resAll.totalObjects, kept: resAll.keptObjects, zone: resAll.zone, squares: resAll.squaresFound })
if (resAll.keptObjects !== 2) throw new Error(`ожидалось 2 контура (осн. + подобъект), получено ${resAll.keptObjects}`)
if (resAll.zone !== 7) throw new Error('зона должна быть 7')

// Фильтр по квадрату: квадрат точки 6183-413 (x=6183 км, y'=413 км)
const resSq = convertSxfToClutter(parsed, { squares: '6183-413' })
console.log('sq 6183-413:', { kept: resSq.keptObjects })
if (resSq.keptObjects !== 2) throw new Error(`фильтр по квадрату должен пропускать оба контура, получено ${resSq.keptObjects}`)

// Чужой квадрат — ничего
const resNone = convertSxfToClutter(parsed, { squares: '1234-567' })
if (resNone.keptObjects !== 0) throw new Error('чужой квадрат должен давать 0 объектов')
console.log('sq 1234-567: 0 ✓')

// Проверка координат: обратно в СК-42
const f0 = resAll.geojson.features[0]
const ring = f0.geometry!.coordinates as number[][][]
const wgs = ring[0][0]
const sk = wgs84ToSk42({ lat: wgs[1], lon: wgs[0] })
console.log('roundtrip wgs:', wgs.map((v) => +v.toFixed(6)), 'sk:', { zone: sk.zone, x: Math.round(sk.x), y: Math.round(sk.y) })
if (sk.zone !== 7 || Math.abs(sk.x - 6183500) > 5 || Math.abs(sk.y - 7413500) > 5) {
  throw new Error('обратное преобразование СК-42 не сходится')
}

// Слияние: дубликаты не добавляются
const merged = mergeClutter(resAll.geojson, resAll.geojson)
if (merged.features.length !== resAll.geojson.features.length) {
  throw new Error(`слияние с собой должно давать тот же размер: ${merged.features.length} != ${resAll.geojson.features.length}`)
}
console.log('merge dedupe ✓', merged.features.length)

// Парсер списка квадратов
const sq = parseSquaresList('6183-413, 6184-414; 1234:567')
console.log('squares:', [...sq])
if (sq.size !== 3) throw new Error('ожидалось 3 квадрата')

console.log('\n=== SXF/parser tests OK ===')

// --- buildFreqList: проверка через копию логики (12 точек) ---
const MAX_RANGE_POINTS = 12
function buildFreqList(from: number, to: number): number[] {
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  if (!(isFinite(a) && isFinite(b)) || b <= a) return [isFinite(from) ? from : a]
  const raw = (b - a) / (MAX_RANGE_POINTS - 1)
  const step = Math.max(0.01, Math.round(raw * 100) / 100)
  const list: number[] = []
  for (let f = a; f <= b + 1e-9 && list.length < MAX_RANGE_POINTS; f += step) {
    list.push(Math.round(f * 100) / 100)
  }
  if (list[list.length - 1] !== b) list[list.length - 1] = b
  return list
}
const fl = buildFreqList(2400, 2480)
console.log('freq list:', fl)
if (fl.length !== 12 || fl[0] !== 2400 || fl[11] !== 2480) throw new Error('список частот неверен')
console.log('=== freq list OK ===')
