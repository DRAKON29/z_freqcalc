/** Хелперы для тестов SXF: синтетический бинарный SXF. */
export const ZONE = 7
export const X0 = 6_183_000 // север, м (СК-42)
export const Y0 = 7_413_000 // восток с номером зоны, м

const PASSPORT_SIZE = 1024

/** Синтетический SXF: сигнатура + паспорт + записи объектов. */
export function makeSxfBuffer(
  objects: Array<{ code: number; metricType: number; points: Array<[number, number]> }>,
): ArrayBuffer {
  const records = objects.map((o) => {
    const pointsBytes = o.points.length * 8
    return { o, recLen: 32 + pointsBytes }
  })
  const total = PASSPORT_SIZE + records.reduce((s, r) => s + r.recLen, 0)
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)

  // Сигнатура SXF v4 (little-endian 0x00304453)
  view.setUint32(0, 0x00304453, true)
  view.setInt32(0x04, 4, true) // версия
  view.setInt32(0x08, 1, true) // проекция Гаусса–Крюгера
  view.setInt32(0x38, 100000, true) // масштаб

  let off = PASSPORT_SIZE
  for (const { o, recLen } of records) {
    view.setInt32(off, recLen, true)
    view.setInt32(off + 8, o.code, true)
    view.setInt16(off + 16, o.metricType, true)
    view.setInt16(off + 18, 0, true)
    view.setInt32(off + 20, o.points.length, true)
    view.setInt16(off + 24, 8, true)
    let p = off + 32
    for (const [x, y] of o.points) {
      view.setInt32(p, x, true)
      view.setInt32(p + 4, y, true)
      p += 8
    }
    off += recLen
  }
  return buf
}
