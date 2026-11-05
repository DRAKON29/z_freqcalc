/**
 * Генерация синтетического SXF-файла для теста конвертации в браузере.
 * Зона 7, два площадных объекта (лес код 20, застройка код 7) в квадратах 6183-413 и 6184-414.
 * Запуск: bun scripts/gen-sxf.ts /tmp/test.sxf
 */
const OUT = process.argv[2] ?? '/tmp/test.sxf'

const buf = new ArrayBuffer(2048)
const dv = new DataView(buf)
dv.setUint32(0x00, 0x00304453, true) // сигнатура
dv.setInt32(0x04, 4, true) // версия
dv.setInt32(0x08, 1, true) // Гаусс-Крюгер
dv.setInt32(0x38, 100000, true) // масштаб

function makeRecord(code: number, pts: Array<[number, number]>): Uint8Array {
  const rec = new Uint8Array(32 + pts.length * 8)
  const d = new DataView(rec.buffer)
  d.setInt32(0, rec.length, true)
  d.setInt16(4, 1, true)
  d.setInt32(8, code, true)
  d.setInt32(12, 100000, true)
  d.setInt16(16, 1, true) // площадная
  d.setInt16(18, 0, true) // без подобъектов
  d.setInt32(20, pts.length, true)
  d.setInt16(24, 8, true)
  pts.forEach(([x, y], i) => {
    d.setInt32(32 + i * 8, x, true)
    d.setInt32(36 + i * 8, y, true)
  })
  return rec
}

// Лес в квадрате 6183-413
const forest = makeRecord(20, [
  [6183000, 7413000],
  [6183500, 7413000],
  [6183500, 7413500],
  [6183000, 7413500],
  [6183000, 7413000],
])
// Застройка в квадрате 6184-414
const blocks = makeRecord(7, [
  [6184000, 7414000],
  [6184500, 7414000],
  [6184500, 7414500],
  [6184000, 7414500],
  [6184000, 7414000],
])

let off = 1024
new Uint8Array(buf).set(forest, off)
off += forest.length
new Uint8Array(buf).set(blocks, off)
off += blocks.length

const out = buf.slice(0, off)
await Bun.write(OUT, out)
console.log(`written ${OUT}: ${out.byteLength} bytes`)
