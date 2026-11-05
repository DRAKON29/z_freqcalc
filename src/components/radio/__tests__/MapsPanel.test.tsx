/**
 * Тесты MapsPanel: загрузка карт ITU (расширение/лимит, wasm-режим → IndexedDB),
 * SRTM-тайлы, конвертация SXF/RSC с фильтром по квадратам и добавлением к данным,
 * clutter.geojson, очистка данных. Leaflet мокается (карта покрыта слоем-заглушкой).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MapsPanel } from '../MapsPanel'
import { useRadioStore } from '@/store/radio-store'
import { resetStore } from './test-utils'
import { getDeviceId, clearHistory, getClutterCache } from '@/lib/radio/history'
import { makeHgtBuffer } from '../../../lib/radio/__tests__/terrain-helpers'
import { makeSxfBuffer, ZONE, X0, Y0 } from '../../../lib/radio/__tests__/sxf-helpers'

// Leaflet не рендерим — тесты покрывают логику панелей, а не карту
vi.mock('leaflet', () => {
  const leaflet = {
    map: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      on: vi.fn(),
      setView: vi.fn().mockReturnThis(),
      fitBounds: vi.fn(),
      removeLayer: vi.fn(),
    })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn() })),
    latLng: vi.fn(),
    // latLngBounds: extend() и pad() возвращают this (как в Leaflet)
    latLngBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis(), pad: vi.fn().mockReturnThis() })),
    rectangle: vi.fn(() => ({ bindTooltip: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis() })),
    polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), getBounds: vi.fn(() => ({ extend: vi.fn().mockReturnThis() })) })),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
    divIcon: vi.fn(),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
  }
  return { default: leaflet, ...leaflet }
})

beforeEach(async () => {
  resetStore()
  localStorage.clear()
  await clearHistory(getDeviceId())
})
afterEach(() => {
  // Важно: не restoreAllMocks — он затирает реализации vi.fn() из фабрики мока leaflet
  vi.clearAllMocks()
})

/** Загрузка файла в скрытый input (userEvent.upload не работает с hidden в jsdom). */
function uploadFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

function fileInput(accept: string): HTMLInputElement {
  const input = document.querySelector(`input[type="file"][accept="${accept}"]`) as HTMLInputElement
  if (!input) throw new Error(`file input ${accept} not found`)
  return input
}

/** Чтение реального файла продукта ITU из фикстур (копии данных пользователя). */
function ituFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), `tests/fixtures/itu/${name}`), 'utf-8')
}

describe('карты ITU: валидация загрузки', () => {
  it('файл с недопустимым расширением → ошибка без упоминания ТЗ', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['x'], 'map.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(screen.getByText('Допустимы только файлы .txt и .zip')).toBeInTheDocument())
  })
  it('файл с двойным расширением обрабатывается корректно (path.docx → ошибка)', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['x'], 'archive.docx'))
    await waitFor(() => expect(screen.getByText('Допустимы только файлы .txt и .zip')).toBeInTheDocument())
  })
  it('в wasm-режиме .txt сохраняется в браузере с сообщением', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['rain data'], 'p837.txt'))
    await waitFor(() => expect(screen.getByText(/Карта p837.txt сохранена в браузере/)).toBeInTheDocument())
  })
  it('в wasm-режиме .zip сохраняется и виден в кэше карт', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['PK'], 'maps.zip'))
    await waitFor(() => expect(screen.getByText(/Карта maps.zip сохранена в браузере/)).toBeInTheDocument())
    const { listItuMaps } = await import('@/lib/radio/history')
    expect((await listItuMaps()).map((m) => m.name)).toContain('maps.zip')
  })
  it('в http-режиме превышение лимита → сообщение о размере', async () => {
    useRadioStore.setState({ backend: 'http' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<MapsPanel />)
    // Лимит 700 МБ (734.0032 МБ в двоичных МБ), имитируем размер через defineProperty
    const big = new File(['x'], 'big.txt')
    Object.defineProperty(big, 'size', { value: 800 * 1024 * 1024 })
    uploadFile(fileInput('.txt,.zip'), big)
    await waitFor(() => expect(screen.getByText(/превышает лимит/)).toBeInTheDocument())
    vi.unstubAllGlobals()
  })
  it('в http-режиме недоступный сервис → понятная ошибка', async () => {
    useRadioStore.setState({ backend: 'http' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['x'], 'p837.txt'))
    await waitFor(() => expect(screen.getByText(/Сервис недоступен/)).toBeInTheDocument())
    vi.unstubAllGlobals()
  })

  it('в http-режиме при недоступном сервисе известный продукт всё равно сохраняется локально и участвует в расчёте', async () => {
    useRadioStore.setState({ backend: 'http' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File([ituFixture('DN_Median.txt')], 'DN_Median.txt'))
    await waitFor(() => expect(screen.getByText(/Сервис недоступен.*сохранён локально/u)).toBeInTheDocument())
    expect(useRadioStore.getState().ituGrids['DN_Median.txt']).toBeDefined()
    await waitFor(() => expect(screen.getByText(/1 из 14/)).toBeInTheDocument())
    vi.unstubAllGlobals()
  })
})

describe('карты ITU: проверка известных продуктов P.2001-6 (реальные файлы)', () => {
  const dnMedian = () => readFileSync(path.resolve(process.cwd(), 'tests/fixtures/itu/DN_Median.txt'), 'utf-8')

  it('реальный DN_Median.txt сохраняется с описанием сетки 121×241', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File([dnMedian()], 'DN_Median.txt'))
    await waitFor(() =>
      expect(screen.getByText(/Карта DN_Median\.txt \(ITU-R P\.2001 § 3\.4\.1: сетка 121×241.*сохранена в браузере/)).toBeInTheDocument(),
    )
  })

  it('повреждённая сетка DN_Median → ошибка проверки с номером строки и числом столбцов', async () => {
    render(<MapsPanel />)
    const broken = dnMedian().split('\n')
    const row = broken[10].trim().split(/\s+/)
    row.pop()
    broken[10] = row.join(' ')
    uploadFile(fileInput('.txt,.zip'), new File([broken.join('\n')], 'DN_Median.txt'))
    await waitFor(() =>
      expect(screen.getByText(/ITU-карта не прошла проверку: DN_Median\.txt: строка 11: ожидается 241 столбцов, получено 240/)).toBeInTheDocument(),
    )
  })

  it('известный продукт, но нечисловой мусор → ошибка, файл не сохранён', async () => {
    render(<MapsPanel />)
    const { listItuMaps } = await import('@/lib/radio/history')
    const before = (await listItuMaps()).map((m) => m.name)
    // заменяем ровно один токен, чтобы проверка столбцов прошла и сработала проверка числа
    uploadFile(fileInput('.txt,.zip'), new File([dnMedian().replace('40.726', 'CORRUPT')], 'DN_Median.txt'))
    await waitFor(() => expect(screen.getByText(/нечисловое значение «CORRUPT»/)).toBeInTheDocument())
    const after = (await listItuMaps()).map((m) => m.name)
    expect(after.filter((n) => !before.includes(n))).toEqual([])
  })

  it('неизвестное имя .txt по-прежнему сохраняется без проверки сетки', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['garbage'], 'my_own.txt'))
    await waitFor(() => expect(screen.getByText(/Карта my_own\.txt сохранена в браузере/)).toBeInTheDocument())
  })
})

describe('рельеф: загрузка SRTM .hgt', () => {
  it('валидный тайл попадает в store и кэшируется, границы отрисованы (заглушка карты)', async () => {
    render(<MapsPanel />)
    const buf = makeHgtBuffer(1201, () => 120)
    uploadFile(fileInput('.hgt'), new File([buf], 'N47E039.hgt'))
    await waitFor(() => expect(screen.getByText(/Тайл N47E039.hgt загружен и закэширован/)).toBeInTheDocument())
    expect(useRadioStore.getState().hgtTiles).toHaveLength(1)
  })
  it('битый тайл → ошибка парсера (сообщение от addHgtTile)', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.hgt'), new File([new ArrayBuffer(10)], 'bad.hgt'))
    await waitFor(() => expect(screen.getByText(/не соответствует формату NXXEXXX/)).toBeInTheDocument())
  })
  it('без тайлов показывается подсказка о пустой карте', () => {
    render(<MapsPanel />)
    expect(screen.getByText(/Тайлы не загружены — карта пуста/)).toBeInTheDocument()
  })
  it('с тайлами и трассой вне покрытия показывается предупреждение', () => {
    const buf = makeHgtBuffer(1201, () => 100)
    useRadioStore.getState().addHgtTile(buf, 'N47E039.hgt')
    render(<MapsPanel />)
    expect(screen.getByText(/Трасса выходит за пределы тайлов — загрузите соседние тайлы/)).toBeInTheDocument()
  })
  it('счётчик загруженных тайлов', () => {
    const buf = makeHgtBuffer(1201, () => 100)
    useRadioStore.getState().addHgtTile(buf, 'N47E039.hgt')
    render(<MapsPanel />)
    expect(screen.getByText(/Загружено тайлов:/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('здания и растительность: конвертация SXF/RSC', () => {
  it('без выбранного файла кнопка конвертации заблокирована (guard в disabled)', () => {
    render(<MapsPanel />)
    const btn = screen.getByRole('button', { name: /Конвертировать и добавить/ })
    expect(btn).toBeDisabled()
  })
  it('не-SXF файл → понятная ошибка о сигнатуре', async () => {
    const user = userEvent.setup()
    render(<MapsPanel />)
    uploadFile(fileInput('.sxf'), new File([new ArrayBuffer(2048)], 'fake.sxf'))
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => expect(screen.getByText(/не распознан как SXF/)).toBeInTheDocument())
  })
  it('валидный SXF конвертируется и добавляется к данным с сообщением о зоне', async () => {
    const user = userEvent.setup()
    render(<MapsPanel />)
    const buf = makeSxfBuffer([{ code: 7, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200], [X0, Y0 + 200]] }])
    uploadFile(fileInput('.sxf'), new File([buf], 'map.sxf'))
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => expect(screen.getByText(/Готово: в файле 1 площадных объектов/)).toBeInTheDocument())
    expect(screen.getByText(new RegExp(`Зона СК-42: ${ZONE}`))).toBeInTheDocument()
    expect(useRadioStore.getState().clutter).not.toBeNull()
  })
  it('фильтр по квадратам: чужой квадрат → сообщение со статусом файла', async () => {
    const user = userEvent.setup()
    render(<MapsPanel />)
    const buf = makeSxfBuffer([{ code: 7, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200]] }])
    uploadFile(fileInput('.sxf'), new File([buf], 'map.sxf'))
    const squares = screen.getByPlaceholderText('6183-413, 6183-414, 6184-413')
    await user.type(squares, '9999-999')
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => expect(screen.getByText(/Площадных объектов по выбранным квадратам не найдено/)).toBeInTheDocument())
  })
  it('повторная конвертация добавляет объекты, а не перезаписывает (дедупликация по id)', async () => {
    const user = userEvent.setup()
    render(<MapsPanel />)
    const buf = makeSxfBuffer([{ code: 7, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200], [X0, Y0 + 200]] }])
    uploadFile(fileInput('.sxf'), new File([buf], 'map.sxf'))
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => expect(screen.getByText(/Готово/)).toBeInTheDocument())
    // Повторная конвертация того же файла
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => {
      const text = screen.getByText(/Готово: в файле 1 площадных объектов/).textContent
      expect(text).toContain('всего 1') // дубликат не добавлен
    })
  })
  it('данные кэшируются в IndexedDB', async () => {
    const user = userEvent.setup()
    render(<MapsPanel />)
    const buf = makeSxfBuffer([{ code: 20, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200]] }])
    uploadFile(fileInput('.sxf'), new File([buf], 'forest.sxf'))
    await user.click(screen.getByRole('button', { name: /Конвертировать и добавить/ }))
    await waitFor(() => expect(screen.getByText(/Готово/)).toBeInTheDocument())
    const cached = await getClutterCache()
    expect(cached).not.toBeNull()
  })
  it('кнопка «Очистить данные» убирает clutter и кэш', async () => {
    const user = userEvent.setup()
    const buf = makeSxfBuffer([{ code: 7, metricType: 1, points: [[X0, Y0], [X0 + 200, Y0], [X0 + 200, Y0 + 200]] }])
    const { convertSxfToClutter, parseSxf } = await import('@/lib/radio/sxf')
    const res = convertSxfToClutter(parseSxf(buf), { squares: '' })
    useRadioStore.getState().setClutter(res.geojson)
    render(<MapsPanel />)
    // Ждём загрузки кэша на монте (гонка с effect getClutterCache)
    await waitFor(() => expect(useRadioStore.getState().clutter).not.toBeNull())
    await user.click(screen.getByRole('button', { name: /Очистить данные/ }))
    await waitFor(() => expect(useRadioStore.getState().clutter).toBeNull())
    expect(await getClutterCache()).toBeNull()
  })
})

describe('продукты ITU-R P.2001-6: таблица участия в расчёте', () => {
  beforeEach(async () => {
    // Чистый кэш карт: предыдущие тесты файла могут оставлять файлы в IndexedDB
    const { listItuMaps, deleteItuMap } = await import('@/lib/radio/history')
    for (const m of await listItuMaps()) await deleteItuMap(m.name)
    useRadioStore.setState({ ituGrids: {}, ituLoadErrors: {} })
  })

  it('таблица показывает все 14 продуктов Table 3 и счётчик 0 из 14', () => {
    render(<MapsPanel />)
    expect(screen.getByText('DN_Median.txt')).toBeInTheDocument()
    expect(screen.getByText('dndz_01.txt')).toBeInTheDocument()
    expect(screen.getByText('TropoClim.txt')).toBeInTheDocument()
    expect(screen.getByText('Surfwv_50_fixed.txt')).toBeInTheDocument()
    expect(screen.getByText('FoEs50.txt')).toBeInTheDocument()
    expect(screen.getByText('h0.txt')).toBeInTheDocument()
    expect(screen.getByText(/0 из 14/)).toBeInTheDocument()
  })

  it('загрузка реального DN_Median.txt: продукт в store, счётчик 1 из 14, сообщение про участие в расчёте', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File([ituFixture('DN_Median.txt')], 'DN_Median.txt'))
    await waitFor(() => expect(screen.getByText(/и участвует в расчёте/)).toBeInTheDocument())
    expect(useRadioStore.getState().ituGrids['DN_Median.txt']).toBeDefined()
    await waitFor(() => expect(screen.getByText(/1 из 14/)).toBeInTheDocument())
    expect(screen.getAllByText('загружено').length).toBe(1)
  })

  it('загрузка TropoClim.txt (360×720, зоны) принимается и участвует', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File([ituFixture('TropoClim.txt')], 'TropoClim.txt'))
    await waitFor(() => expect(screen.getByText(/Карта TropoClim\.txt.*сохранена в браузере/)).toBeInTheDocument())
    expect(useRadioStore.getState().ituGrids['TropoClim.txt']).toBeDefined()
  })

  it('удаление продукта убирает его из store и кэша, счётчик возвращается к 0 из 14', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File([ituFixture('DN_Median.txt')], 'DN_Median.txt'))
    await waitFor(() => expect(useRadioStore.getState().ituGrids['DN_Median.txt']).toBeDefined())
    const user = userEvent.setup()
    await user.click(screen.getByTitle('Удалить продукт'))
    await waitFor(() => expect(useRadioStore.getState().ituGrids['DN_Median.txt']).toBeUndefined())
    await waitFor(() => expect(screen.getByText(/0 из 14/)).toBeInTheDocument())
    const { listItuMaps } = await import('@/lib/radio/history')
    expect((await listItuMaps()).map((m) => m.name)).not.toContain('DN_Median.txt')
  })

  it('прочие файлы (не продукты) показываются отдельно как «прочие сохранённые»', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.txt,.zip'), new File(['custom'], 'my_own.txt'))
    await waitFor(() => expect(screen.getByText(/Прочие сохранённые файлы/)).toBeInTheDocument())
    expect(screen.getAllByText('my_own.txt').length).toBeGreaterThan(0)
    // но в продуктовые сетки он не попадает
    expect(Object.keys(useRadioStore.getState().ituGrids)).toHaveLength(0)
  })
})

describe('clutter.geojson (готовый файл)', () => {
  it('валидный GeoJSON добавляется к существующим данным', async () => {
    render(<MapsPanel />)
    const gj = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[37.6, 55.7], [37.62, 55.7], [37.62, 55.72], [37.6, 55.72], [37.6, 55.7]]] }, properties: { type: 'building', height: 20, id: 'b1' } },
      ],
    }
    uploadFile(fileInput('.geojson,.json'), new File([JSON.stringify(gj)], 'clutter.geojson'))
    await waitFor(() => expect(screen.getByText(/clutter\.geojson принят: 1 объектов добавлено/)).toBeInTheDocument())
    expect(useRadioStore.getState().clutter!.features).toHaveLength(1)
  })
  it('невалидный JSON → ошибка', async () => {
    render(<MapsPanel />)
    uploadFile(fileInput('.geojson,.json'), new File(['{bad json'], 'clutter.geojson'))
    await waitFor(() => expect(screen.getByText(/Некорректный JSON/)).toBeInTheDocument())
  })
  it('второй файл добавляется к первому (не перезаписывает)', async () => {
    render(<MapsPanel />)
    const feat = (id: string) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[37.6, 55.7], [37.62, 55.7], [37.62, 55.72], [37.6, 55.72], [37.6, 55.7]]] }, properties: { type: 'building', height: 20, id } })
    uploadFile(fileInput('.geojson,.json'), new File([JSON.stringify({ type: 'FeatureCollection', features: [feat('a')] })], 'c1.geojson'))
    await waitFor(() => expect(screen.getByText(/clutter\.geojson принят: 1 объектов/)).toBeInTheDocument())
    uploadFile(fileInput('.geojson,.json'), new File([JSON.stringify({ type: 'FeatureCollection', features: [feat('b')] })], 'c2.geojson'))
    await waitFor(() => {
      const text = screen.getByText(/clutter\.geojson принят: 1 объектов добавлено/).textContent
      expect(text).toContain('всего 2')
    })
    expect(useRadioStore.getState().clutter!.features).toHaveLength(2)
  })
})
