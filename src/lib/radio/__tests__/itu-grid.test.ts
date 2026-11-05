/**
 * Тесты модуля цифровых продуктов ITU-R P.2001-6 (itu-grid.ts):
 *  • реестр спецификаций Table 3 (README_P2001-6.docx);
 *  • парсер текстовых сеток (размеры, числа, научная запись);
 *  • билинейная интерполяция P.1144 (узлы, середины, зажим широты, обёртка 360°);
 *  • ближайший узел для TropoClim (сдвиг на полпикселя, без интерполяции);
 *  • реальные файлы пользователя из tests/fixtures/itu (9 продуктов,
 *    якорные значения первых узлов проверены скриптом по исходным файлам).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ITU_GRID_SPECS,
  findItuGridSpec,
  parseItuGridText,
  parseItuGrid,
  bilinearItu,
  nearestZoneItu,
  interpolateItu,
  validateItuFile,
  ItuGridParseError,
  type ItuGridSpec,
} from '../itu-grid'

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/itu')

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf-8')
}

/** Синтетическая сетка: value(i, j) задаётся функцией от индексов. */
function syntheticGridText(rows: number, cols: number, value: (i: number, j: number) => number): string {
  const lines: string[] = []
  for (let i = 0; i < rows; i++) {
    const row: string[] = []
    for (let j = 0; j < cols; j++) row.push(String(value(i, j)))
    lines.push(row.join(' '))
  }
  return lines.join('\n') + '\n'
}

const SMALL: ItuGridSpec = {
  name: 'small.txt', ref: 'тест', origin: 'синтетика',
  lat0: 10, dLat: 2, rows: 3, lon0: 0, dLon: 3, cols: 4,
}

describe('реестр спецификаций Table 3 (README_P2001-6)', () => {
  it('содержит 14 цифровых продуктов', () => {
    expect(ITU_GRID_SPECS).toHaveLength(14)
  })

  it('сетка P.2001/P.453/P.839/P.836/FoEs: 121×241, шаг 1.5°, первая строка 90°N', () => {
    for (const name of ['DN_Median.txt', 'DN_SupSlope.txt', 'DN_SubSlope.txt', 'dndz_01.txt', 'h0.txt', 'Surfwv_50_fixed.txt', 'FoEs50.txt', 'FoEs10.txt', 'FoEs01.txt', 'FoEs0.1.txt']) {
      const s = findItuGridSpec(name)
      expect(s, name).toBeDefined()
      expect(s!.rows).toBe(121)
      expect(s!.cols).toBe(241)
      expect(s!.dLat).toBe(1.5)
      expect(s!.dLon).toBe(1.5)
      expect(s!.lat0).toBe(90)
      expect(s!.lon0).toBe(0)
    }
  })

  it('дождевые продукты P.837-5: 161×321, шаг 1.125°', () => {
    for (const name of ['Esarain_Pr6_v5.txt', 'Esarain_Mt_v5.txt', 'Esarain_Beta_v5.txt']) {
      const s = findItuGridSpec(name)
      expect(s, name).toBeDefined()
      expect(s!.rows).toBe(161)
      expect(s!.cols).toBe(321)
      expect(s!.dLat).toBe(1.125)
      expect(s!.dLon).toBe(1.125)
    }
  })

  it('TropoClim: 360×720, шаг 0.5°, сдвиг на полпикселя, зоны без интерполяции', () => {
    const s = findItuGridSpec('TropoClim.txt')
    expect(s).toBeDefined()
    expect(s!.lat0).toBe(89.75)
    expect(s!.lon0).toBe(-179.75)
    expect(s!.dLat).toBe(0.5)
    expect(s!.dLon).toBe(0.5)
    expect(s!.rows).toBe(360)
    expect(s!.cols).toBe(720)
    expect(s!.zoneBased).toBe(true)
  })

  it('поиск без учёта регистра и неизвестное имя → undefined', () => {
    expect(findItuGridSpec('dn_median.TXT')?.name).toBe('DN_Median.txt')
    expect(findItuGridSpec('  FoEs01.txt ')).toBeDefined()
    expect(findItuGridSpec('p837.txt')).toBeUndefined()
    expect(findItuGridSpec('Tropoclim.txt')).toBeDefined()
  })
})

describe('парсер текстовых сеток (синтетика)', () => {
  it('валидная сетка 3×4 разбирается, значения на местах', () => {
    const text = syntheticGridText(3, 4, (i, j) => i * 10 + j)
    const grid = parseItuGridText(text, SMALL)
    expect(grid.rows).toBe(3)
    expect(grid.cols).toBe(4)
    expect(grid.values[0][0]).toBe(0)
    expect(grid.values[2][3]).toBe(23)
  })

  it('научная запись (1.03e-002) разбирается', () => {
    const text = syntheticGridText(3, 4, () => 0) + ''
    const withSci = text
      .split('\n')
      .map((l, i) => (i === 1 ? l.replace(/^-?\d+(\.\d+)?/, '1.0320068e-002') : l))
      .join('\n')
    const grid = parseItuGridText(withSci, SMALL)
    expect(grid.values[1][0]).toBeCloseTo(0.010320068, 12)
  })

  it('лишняя строка → ошибка с числом строк', () => {
    const text = syntheticGridText(4, 4, () => 1)
    expect(() => parseItuGridText(text, SMALL)).toThrow(ItuGridParseError)
    expect(() => parseItuGridText(text, SMALL)).toThrow(/ожидается 3 строк, получено 4/)
  })

  it('недостающая строка → ошибка', () => {
    const text = syntheticGridText(2, 4, () => 1)
    expect(() => parseItuGridText(text, SMALL)).toThrow(/ожидается 3 строк, получено 2/)
  })

  it('неверное число столбцов в конкретной строке → ошибка с номером строки', () => {
    const text = syntheticGridText(3, 4, () => 1)
    const broken = text.split('\n')
    broken[1] = broken[1].trim().split(/\s+/).slice(0, 3).join(' ')
    expect(() => parseItuGridText(broken.join('\n'), SMALL)).toThrow(/строка 2: ожидается 4 столбцов, получено 3/)
  })

  it('нечисловое значение → ошибка с координатами и токеном', () => {
    const text = syntheticGridText(3, 4, () => 1).replace('1 1 1 1\n', 'abc 1 1 1\n')
    expect(() => parseItuGridText(text, SMALL)).toThrow(/строка 1, столбец 1: нечисловое значение «abc»/)
  })

  it('NaN и Infinity отклоняются', () => {
    const nanText = syntheticGridText(3, 4, () => 1).replace('1 1 1 1\n', 'NaN 1 1 1\n')
    expect(() => parseItuGridText(nanText, SMALL)).toThrow(/NaN/)
    const infText = syntheticGridText(3, 4, () => 1).replace('1 1 1 1\n', 'Infinity 1 1 1\n')
    expect(() => parseItuGridText(infText, SMALL)).toThrow(/Infinity/)
  })

  it('пустой файл → ошибка о числе строк', () => {
    expect(() => parseItuGridText('\n \n', SMALL)).toThrow(/ожидается 3 строк, получено 0/)
  })

  it('CRLF-переводы строк поддерживаются', () => {
    const lf = syntheticGridText(3, 4, (i, j) => i + j)
    const grid = parseItuGridText(lf.replace(/\n/g, '\r\n'), SMALL)
    expect(grid.values[1][2]).toBe(3)
  })

  it('parseItuGrid по неизвестному имени → понятная ошибка', () => {
    expect(() => parseItuGrid('custom.txt', '1 2')).toThrow(/Table 3/)
  })
})

describe('билинейная интерполяция P.1144 (синтетика)', () => {
  // Линейное поле: значение = 100 + 2·lat + 3·lon — билинейная интерполяция точна
  const lin = (lat: number, lon: number) => 100 + 2 * lat + 3 * lon
  const text = syntheticGridText(3, 4, (i, j) => lin(10 - i * 2, j * 3))
  const grid = parseItuGridText(text, SMALL)

  it('в узлах сетки возвращает точное значение узла', () => {
    expect(bilinearItu(grid, 10, 0)).toBeCloseTo(lin(10, 0), 9)
    expect(bilinearItu(grid, 10, 9)).toBeCloseTo(lin(10, 9), 9)
    expect(bilinearItu(grid, 8, 3)).toBeCloseTo(lin(8, 3), 9)
    expect(bilinearItu(grid, 6, 0)).toBeCloseTo(lin(6, 0), 9)
    expect(bilinearItu(grid, 6, 9)).toBeCloseTo(lin(6, 9), 9)
  })

  it('в середине ячейки — среднее четырёх узлов', () => {
    const expectMid = bilinearItu(grid, 9, 1.5)
    const avg = (grid.values[0][0] + grid.values[1][0] + grid.values[0][1] + grid.values[1][1]) / 4
    expect(expectMid).toBeCloseTo(avg, 9)
    // и совпадает с линейным полем
    expect(expectMid).toBeCloseTo(lin(9, 1.5), 9)
  })

  it('ширина широты: ниже нижней строки берётся крайняя (клэмп)', () => {
    expect(bilinearItu(grid, -50, 0)).toBeCloseTo(lin(6, 0), 9)
    expect(bilinearItu(grid, 99, 0)).toBeCloseTo(lin(10, 0), 9) // выше lat0
  })

  it('обёртка долготы: 10° ≡ 1°, −2° ≡ 7° (охват сетки 9°)', () => {
    // охват сетки: (4-1)·3 = 9° → 10° ≡ 1°, −2° ≡ 7°
    expect(bilinearItu(grid, 10, 10)).toBeCloseTo(bilinearItu(grid, 10, 1), 9)
    expect(bilinearItu(grid, 10, -2)).toBeCloseTo(bilinearItu(grid, 10, 7), 9)
  })

  it('интерполяция на произвольной дробной точке согласуется с полем', () => {
    expect(bilinearItu(grid, 7.4, 5.2)).toBeCloseTo(lin(7.4, 5.2), 9)
  })

  it('interpolateItu маршрутизирует: обычная сетка → билинейная, зоновая → ближайший узел', () => {
    expect(interpolateItu(grid, 9, 1.5)).toBeCloseTo(lin(9, 1.5), 9)
    const zoneSpec: ItuGridSpec = { ...SMALL, zoneBased: true }
    const zgrid = parseItuGridText(syntheticGridText(3, 4, (i, j) => i * 100 + j), zoneSpec)
    // (lat 9 → середина между строками 0/1, Math.round(0.5)=1; lon 1 → столбец 0)
    expect(interpolateItu(zgrid, 9, 1)).toBe(zgrid.values[1][0])
  })
})

describe('TropoClim: ближайший узел (синтетика)', () => {
  const zoneSpec: ItuGridSpec = {
    name: 'TropoClim.txt', ref: 'Att E', origin: 'P.2001',
    lat0: 89.75, dLat: 0.5, rows: 3, lon0: -179.75, dLon: 0.5, cols: 3, zoneBased: true,
  }
  // зоны: уникальные целые, чтобы поймать любую интерполяцию
  const grid = parseItuGridText(syntheticGridText(3, 3, (i, j) => i * 10 + j + 1), zoneSpec)

  it('точка в пределах полпикселя от узла → значение этого узла', () => {
    expect(nearestZoneItu(grid, 89.7, -179.7)).toBe(grid.values[0][0])
    expect(nearestZoneItu(grid, 89.4, -179.4)).toBe(grid.values[1][1])
    expect(nearestZoneItu(grid, 89.2, -179.2)).toBe(grid.values[1][1]) // 0.55° → ближе узел 1
  })

  it('зоны не интерполируются: между узлами возвращается узел, а не среднее', () => {
    const v = nearestZoneItu(grid, 89.6, -179.6)
    expect([grid.values[0][0], grid.values[0][1], grid.values[1][0], grid.values[1][1]]).toContain(v)
    expect(v).not.toBe((grid.values[0][0] + grid.values[1][1]) / 2)
  })

  it('клэмп за пределы сетки: широта южнее последней строки, долгота западнее/восточнее', () => {
    expect(nearestZoneItu(grid, -89.9, 0)).toBe(grid.values[2][2]) // последняя строка
    expect(nearestZoneItu(grid, 89.75, -180)).toBe(grid.values[0][0]) // западный край
    expect(nearestZoneItu(grid, 89.75, 500)).toBe(grid.values[0][2]) // восточный край
  })
})

describe('реальные файлы ITU-R P.2001-6 пользователя (tests/fixtures/itu)', () => {
  // Якорные значения узлов (0°E, 90°N) сняты со斯基птированной проверкой исходных файлов
  const REAL: Array<{ name: string; first: number }> = [
    { name: 'DN_Median.txt', first: 40.726 },
    { name: 'DN_SubSlope.txt', first: 6.179 },
    { name: 'DN_SupSlope.txt', first: 7.781 },
    { name: 'dndz_01.txt', first: -169.4 },
    { name: 'Esarain_Pr6_v5.txt', first: 15.070819 },
    { name: 'Esarain_Mt_v5.txt', first: 65.175569 },
    { name: 'Esarain_Beta_v5.txt', first: 0.010320068 },
    { name: 'FoEs0.1.txt', first: 13.3 },
    { name: 'FoEs01.txt', first: 8.3 },
  ]

  const grids = new Map<string, ReturnType<typeof parseItuGrid>>()
  beforeAll(() => {
    for (const r of REAL) grids.set(r.name, parseItuGrid(r.name, fixture(r.name)))
  })

  it('каждый файл парсится с размерами по Table 3', () => {
    for (const r of REAL) {
      const g = grids.get(r.name)!
      const s = findItuGridSpec(r.name)!
      expect(g.rows, r.name).toBe(s.rows)
      expect(g.cols, r.name).toBe(s.cols)
      expect(g.values).toHaveLength(s.rows)
      expect(g.values[0]).toHaveLength(s.cols)
    }
  })

  it('узел (90°N, 0°E) совпадает с якорным значением файла', () => {
    for (const r of REAL) {
      const g = grids.get(r.name)!
      expect(g.values[0][0], r.name).toBeCloseTo(r.first, 9)
      // интерполяция в самом узле возвращает то же значение
      expect(bilinearItu(g, 90, 0), r.name).toBeCloseTo(r.first, 9)
    }
  })

  it('интерполяция в произвольных узлах совпадает со значениями сетки', () => {
    const dn = grids.get('DN_Median.txt')!
    // (45°N, 180°E): строка 90/1.5=30, столбец 180/1.5=120
    expect(bilinearItu(dn, 45, 180)).toBeCloseTo(dn.values[30][120], 9)
    // (60°N, 90°E): строка 20, столбец 60
    expect(bilinearItu(dn, 60, 90)).toBeCloseTo(dn.values[20][60], 9)
    const pr6 = grids.get('Esarain_Pr6_v5.txt')!
    // (33.75°N, 45°E): строка 56.25→(90−33.75)/1.125=50, столбец 40
    expect(bilinearItu(pr6, 33.75, 45)).toBeCloseTo(pr6.values[50][40], 9)
  })

  it('середина ячейки DN_Median — среднее четырёх соседних узлов', () => {
    const dn = grids.get('DN_Median.txt')!
    // точка (89.25, 0.75): между строками 0/1 и столбцами 0/1
    const avg = (dn.values[0][0] + dn.values[1][0] + dn.values[0][1] + dn.values[1][1]) / 4
    expect(bilinearItu(dn, 89.25, 0.75)).toBeCloseTo(avg, 9)
  })

  it('обёртка 360° на реальной DN_Median: значение у 360° совпадает с 0°', () => {
    const dn = grids.get('DN_Median.txt')!
    expect(bilinearItu(dn, 55, 359.5)).toBeCloseTo(bilinearItu(dn, 55, -0.5), 9)
  })

  it('физические диапазоны: DN_Median — положительные потери 20…80 дБ', () => {
    const dn = grids.get('DN_Median.txt')!
    const all = dn.values.flat()
    expect(Math.min(...all)).toBeGreaterThan(20)
    expect(Math.max(...all)).toBeLessThan(80)
  })

  it('dndz_01: градиент dN/dz всюду отрицательный (минус 58…минус 1796 N/км)', () => {
    const g = grids.get('dndz_01.txt')!
    const all = g.values.flat()
    expect(Math.max(...all)).toBeLessThan(0)
    expect(Math.min(...all)).toBeGreaterThan(-1800)
  })

  it('Esarain_Beta_v5: доля времени дождя в диапазоне 0…1', () => {
    const g = grids.get('Esarain_Beta_v5.txt')!
    const all = g.values.flat()
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...all)).toBeLessThanOrEqual(1)
  })

  it('Esarain шаг 1.125°: интерполяция между узлами (55°N, 30°E) между узлами', () => {
    const pr6 = grids.get('Esarain_Pr6_v5.txt')!
    const v = bilinearItu(pr6, 55, 30)
    // узлы вокруг: строки (90-55)/1.125≈31.1, столбцы 30/1.125≈26.7 — дробные индексы
    const i = Math.floor((90 - 55) / 1.125)
    const j = Math.floor(30 / 1.125)
    const corner = [pr6.values[i][j], pr6.values[i + 1][j], pr6.values[i][j + 1], pr6.values[i + 1][j + 1]]
    expect(Math.min(...corner)).toBeLessThanOrEqual(v)
    expect(Math.max(...corner)).toBeGreaterThanOrEqual(v)
  })

  it('последний столбец: у большинства строк дублирует первый, у 30 строк отличается на шаг дискретизации — интерполяция у кромки всё равно корректна', () => {
    const g = grids.get('FoEs0.1.txt')!
    const differingRows = g.values.filter((r) => Math.abs(r[0] - r[240]) > 1e-9).length
    expect(differingRows).toBe(30)
    // запрос у кромки 360° не выбрасывает и возвращает конечное значение
    const v = bilinearItu(g, 50, 359.9)
    expect(Number.isFinite(v)).toBe(true)
    // 360° ≡ 0°: интерполяция с обёрткой вне диапазона не падает
    expect(Number.isFinite(bilinearItu(g, 50, 360.1))).toBe(true)
  })

  it('validateItuFile: реальный DN_Median проходит, info содержит размеры сетки', () => {
    const v = validateItuFile('DN_Median.txt', fixture('DN_Median.txt'))
    expect(v.ok).toBe(true)
    expect(v.info).toMatch(/121×241/)
    expect(v.info).toMatch(/1\.5°×1\.5°/)
    expect(v.info).toMatch(/P\.2001/)
  })

  it('validateItuFile: реальный Esarain_Pr6_v5 проходит с шагом 1.125°', () => {
    const v = validateItuFile('Esarain_Pr6_v5.txt', fixture('Esarain_Pr6_v5.txt'))
    expect(v.ok).toBe(true)
    expect(v.info).toMatch(/161×321/)
    expect(v.info).toMatch(/1\.125°×1\.125°/)
    expect(v.info).toMatch(/P\.837-5/)
  })

  it('validateItuFile: повреждённый DN_Median (удалён токен в середине) → ошибка с номером строки', () => {
    const text = fixture('DN_Median.txt').split('\n')
    // строка 61 (индекс 60, широта 0°): удаляем один токен
    const row = text[60].trim().split(/\s+/)
    row.splice(100, 1)
    text[60] = row.join(' ')
    const v = validateItuFile('DN_Median.txt', text.join('\n'))
    expect(v.ok).toBe(false)
    expect(v.error).toMatch(/строка 61: ожидается 241 столбцов, получено 240/)
  })

  it('validateItuFile: файл с нечисловым мусором в известном продукте → ошибка', () => {
    // заменяем ровно один токен, чтобы проверка столбцов прошла и сработала проверка числа
    const text = fixture('FoEs01.txt').replace('8.30 ', 'CORRUPT ')
    const v = validateItuFile('FoEs01.txt', text)
    expect(v.ok).toBe(false)
    expect(v.error).toMatch(/нечисловое значение «CORRUPT»/)
  })

  it('validateItuFile: неизвестное имя принимается без проверки (произвольные данные)', () => {
    const v = validateItuFile('p837.txt', 'это не сетка')
    expect(v.ok).toBe(true)
    expect(v.info).toBeUndefined()
  })
})
