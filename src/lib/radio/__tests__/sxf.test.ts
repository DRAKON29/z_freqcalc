/**
 * Тесты конвертера SXF/RSC (КБ «Панорама») → clutter GeoJSON:
 * разбор паспорта и записей, классификатор, фильтр по квадратам,
 * слияние с добавлением (не перезапись!), дедупликация.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSxf,
  parseRscNames,
  parseSquaresList,
  convertSxfToClutter,
  mergeClutter,
  SXF_CODE_MAP,
} from '../sxf'
import type { ClutterGeoJson } from '../terrain'
import { makeSxfBuffer, ZONE, X0, Y0 } from './sxf-helpers'

const PASSPORT_SIZE = 1024

describe('parseSxf: разбор бинарного SXF', () => {
  it('паспорт: версия, проекция, масштаб', () => {
    const buf = makeSxfBuffer([
      { code: 7, metricType: 1, points: [[X0, Y0], [X0 + 100, Y0], [X0 + 100, Y0 + 100], [X0, Y0 + 100]] },
    ])
    const r = parseSxf(buf)
    expect(r.passport.version).toBe(4)
    expect(r.passport.projection).toBe('gauss-kruger')
    expect(r.passport.scale).toBe(100000)
  })
  it('зона определяется из первой точки (ведущая цифра Y)', () => {
    const buf = makeSxfBuffer([
      { code: 7, metricType: 1, points: [[X0, Y0], [X0 + 100, Y0], [X0 + 100, Y0 + 100]] },
    ])
    expect(parseSxf(buf).passport.zone).toBe(ZONE)
  })
  it('записи: код, тип метрики, контуры', () => {
    const buf = makeSxfBuffer([
      { code: 9, metricType: 1, points: [[X0, Y0], [X0 + 50, Y0], [X0 + 50, Y0 + 50]] },
    ])
    const r = parseSxf(buf)
    expect(r.objects).toHaveLength(1)
    expect(r.objects[0].code).toBe(9)
    expect(r.objects[0].metricType).toBe(1)
    expect(r.objects[0].contours[0]).toEqual([[X0, Y0], [X0 + 50, Y0], [X0 + 50, Y0 + 50]])
  })
  it('несколько объектов читаются последовательно', () => {
    const buf = makeSxfBuffer([
      { code: 7, metricType: 1, points: [[X0, Y0], [X0 + 10, Y0], [X0 + 10, Y0 + 10]] },
      { code: 20, metricType: 1, points: [[X0 + 1000, Y0], [X0 + 1010, Y0], [X0 + 1010, Y0 + 10]] },
    ])
    expect(parseSxf(buf).objects).toHaveLength(2)
  })
  it('нет сигнатуры → понятная ошибка', () => {
    const buf = new ArrayBuffer(2048)
    expect(() => parseSxf(buf)).toThrow(/не распознан как SXF/)
  })
  it('ASCII-сигнатура "SXF" тоже принимается', () => {
    const buf = makeSxfBuffer([
      { code: 7, metricType: 1, points: [[X0, Y0], [X0 + 10, Y0], [X0 + 10, Y0 + 10]] },
    ])
    const v = new DataView(buf)
    v.setUint8(0, 0x53) // S
    v.setUint8(1, 0x58) // X
    v.setUint8(2, 0x46) // F
    expect(() => parseSxf(buf)).not.toThrow()
  })
  it('ноль объектов → ошибка о повреждённом файле', () => {
    // Сигнатура есть, записей нет
    const buf = new ArrayBuffer(PASSPORT_SIZE)
    const view = new DataView(buf)
    view.setUint32(0, 0x00304453, true)
    expect(() => parseSxf(buf)).toThrow(/не найдено ни одного объекта/)
  })
})

/** Кодирование строки в байты Windows-1251 (RSC хранит текст в cp1251). */
function toCp1251(text: string): ArrayBuffer {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // Кириллица А-я (0x410–0x44F) → 0xC0–0xFF
    bytes[i] = code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code < 128 ? code : 0x3f
  }
  return bytes.buffer as ArrayBuffer
}

describe('parseRscNames: чтение классификатора (cp1251)', () => {
  it('парсит секцию OBJECT: CODE/NAME', () => {
    const text = ['HEADER', 'OBJECT', 'CODE=7', 'NAME=Жилая застройка', 'CODE=20', 'NAME=Лес хвойный', 'END'].join('\r\n')
    const names = parseRscNames(toCp1251(text))
    expect(names[7]).toBe('Жилая застройка')
    expect(names[20]).toBe('Лес хвойный')
  })
  it('значения со знаком = сохраняются целиком', () => {
    const text = 'OBJECT\r\nCODE=9\r\nNAME=Здание = корпус\r\nEND'
    const names = parseRscNames(toCp1251(text))
    expect(names[9]).toBe('Здание = корпус')
  })
  it('битый/бинарный RSC не роняет парсер', () => {
    const buf = new ArrayBuffer(64)
    const v = new DataView(buf)
    for (let i = 0; i < 64; i++) v.setUint8(i, 0xff)
    expect(parseRscNames(buf)).toEqual({})
  })
})

describe('parseSquaresList: список квадратов', () => {
  it('через запятую', () => {
    expect(parseSquaresList('6183-413, 6183-414')).toEqual(new Set(['6183-413', '6183-414']))
  })
  it('разделители: ; и пробелы и слэши', () => {
    expect(parseSquaresList('6183-413; 6183/414  6183:415')).toEqual(
      new Set(['6183-413', '6183-414', '6183-415']),
    )
  })
  it('мусор игнорируется', () => {
    expect(parseSquaresList('abc, 6183-413,,')).toEqual(new Set(['6183-413']))
  })
  it('пустая строка → пустое множество (весь файл)', () => {
    expect(parseSquaresList('').size).toBe(0)
    expect(parseSquaresList('   ').size).toBe(0)
  })
})

describe('convertSxfToClutter: конвертация в GeoJSON', () => {
  const building = { code: 7, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200], [X0, Y0 + 200]] as Array<[number, number]> }
  const forest = { code: 20, metricType: 1, points: [[X0 + 10_000, Y0], [X0 + 10_200, Y0], [X0 + 10_200, Y0 + 200]] as Array<[number, number]> }
  const line = { code: 30, metricType: 0, points: [[X0, Y0], [X0 + 100, Y0]] as Array<[number, number]> }

  it('только площадные объекты попадают в результат', () => {
    const parsed = parseSxf(makeSxfBuffer([building, forest, line]))
    const res = convertSxfToClutter(parsed, { squares: '' })
    expect(res.totalObjects).toBe(2) // line не считается
    expect(res.keptObjects).toBe(2)
  })
  it('тип и высота берутся из классификатора SXF_CODE_MAP', () => {
    const parsed = parseSxf(makeSxfBuffer([building, forest]))
    const res = convertSxfToClutter(parsed, { squares: '' })
    const types = res.geojson.features.map((f) => f.properties.type).sort()
    expect(types).toEqual(['building', 'vegetation'])
    expect(res.geojson.features.find((f) => f.properties.type === 'building')!.properties.height).toBe(SXF_CODE_MAP[7].height)
  })
  it('кольцо полигона замыкается', () => {
    const parsed = parseSxf(makeSxfBuffer([building]))
    const res = convertSxfToClutter(parsed, { squares: '' })
    const ring = res.geojson.features[0]!.geometry!.coordinates[0] as number[][]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })
  it('фильтр по квадратам: оставляет объект нужного квадрата', () => {
    const parsed = parseSxf(makeSxfBuffer([building, forest]))
    // здание с центром ~ (6183.1, 413.1) км → квадрат 6183-413
    const res = convertSxfToClutter(parsed, { squares: '6183-413' })
    expect(res.keptObjects).toBe(1)
    expect(res.geojson.features[0].properties.type).toBe('building')
  })
  it('фильтр по квадратам: чужой квадрат → 0 объектов, сообщение со статусом', () => {
    const parsed = parseSxf(makeSxfBuffer([building]))
    const res = convertSxfToClutter(parsed, { squares: '9999-999' })
    expect(res.keptObjects).toBe(0)
    expect(res.totalObjects).toBe(1)
  })
  it('squaresFound содержит квадраты фактически найденных объектов', () => {
    const parsed = parseSxf(makeSxfBuffer([building]))
    const res = convertSxfToClutter(parsed, { squares: '' })
    expect(res.squaresFound).toContain('6183-413')
  })
  it('неизвестный код → building по умолчанию, высота 10 м', () => {
    const unknown = { code: 399, metricType: 1, points: [[X0, Y0], [X0 + 50, Y0], [X0 + 50, Y0 + 50]] as Array<[number, number]> }
    const res = convertSxfToClutter(parseSxf(makeSxfBuffer([unknown])), { squares: '' })
    expect(res.geojson.features[0].properties.type).toBe('building')
    expect(res.geojson.features[0].properties.height).toBe(10)
  })
  it('имя из RSC подставляется в свойства', () => {
    const res = convertSxfToClutter(parseSxf(makeSxfBuffer([building])), { squares: '', rscNames: { 7: 'Жилое' } })
    expect(res.geojson.features[0].properties.name).toBe('Жилое')
  })
  it('координаты в WGS 84 в разумных пределах (Московский регион)', () => {
    const res = convertSxfToClutter(parseSxf(makeSxfBuffer([building])), { squares: '' })
    const [lon, lat] = (res.geojson.features[0]!.geometry!.coordinates[0] as number[][])[0]
    expect(lat).toBeGreaterThan(54)
    expect(lat).toBeLessThan(57)
    expect(lon).toBeGreaterThan(36)
    expect(lon).toBeLessThan(40)
  })
})

describe('mergeClutter: добавление без перезаписи', () => {
  const feat = (id: string, lon: number): ClutterGeoJson['features'][number] => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[lon, 55], [lon + 0.01, 55], [lon + 0.01, 55.01], [lon, 55], [lon, 55]]] },
    properties: { type: 'building', height: 12, id },
  })
  const fc = (ids: string[]): ClutterGeoJson => ({
    type: 'FeatureCollection',
    features: ids.map((id) => feat(id, 37 + Number(id.split('-')[1]) * 0.01)),
  })

  it('новые данные добавляются к существующим', () => {
    const merged = mergeClutter(fc(['f-1']), fc(['f-2']))
    expect(merged.features).toHaveLength(2)
    expect(merged.features.map((f) => f.properties.id).sort()).toEqual(['f-1', 'f-2'])
  })
  it('дубликаты по id не дублируются (дедупликация)', () => {
    const merged = mergeClutter(fc(['f-1', 'f-2']), fc(['f-2', 'f-3']))
    expect(merged.features).toHaveLength(3)
  })
  it('null (нет существующих) → входные данные как есть', () => {
    const incoming = fc(['f-1', 'f-2'])
    expect(mergeClutter(null, incoming)).toBe(incoming)
  })
  it('перезагрузка того же квадрата не создаёт копий (идемпотентность)', () => {
    const base = fc(['f-1'])
    const same = fc(['f-1'])
    expect(mergeClutter(mergeClutter(base, same), same).features).toHaveLength(1)
  })
  it('объекты без id дедуплицируются по типу/высоте/первой точке', () => {
    const a: ClutterGeoJson = {
      type: 'FeatureCollection',
      features: [feat('f-1', 37)],
    }
    delete (a.features[0].properties as { id?: string }).id
    const b: ClutterGeoJson = {
      type: 'FeatureCollection',
      features: [feat('f-1', 37)],
    }
    delete (b.features[0].properties as { id?: string }).id
    expect(mergeClutter(a, b).features).toHaveLength(1)
  })
})
