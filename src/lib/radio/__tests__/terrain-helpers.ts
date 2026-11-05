/** Общие хелперы для тестов рельефа (используются terrain.test.ts и store). */
import type { HgtTile } from '../terrain'
import { parseHgt } from '../terrain'

/** Синтетический .hgt буфер: size×size int16 BE с функцией высоты. */
export function makeHgtBuffer(size: 1201 | 3601, heightFn: (r: number, c: number) => number): ArrayBuffer {
  const buf = new ArrayBuffer(size * size * 2)
  const view = new DataView(buf)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      view.setInt16((r * size + c) * 2, heightFn(r, c), false)
    }
  }
  return buf
}

/** Тайл N47E039 с плоскостью высот 100 + r − c. */
export function makeTile(size: 1201 | 3601 = 1201): HgtTile {
  return parseHgt(makeHgtBuffer(size, (r, c) => 100 + r - c), 'N47E039.hgt')
}
