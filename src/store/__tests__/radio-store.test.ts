/**
 * Интеграционные тесты глобального состояния (zustand):
 * сеттеры, добавление .hgt-тайлов, «от трассы», расчёт (single/range),
 * предупреждение о покрытии рельефа, многовысотная динамика.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useRadioStore, DEFAULT_EQUIPMENT, DEFAULT_ATMOSPHERE, sk42Of, wgsFromSk42 } from '../radio-store'
import { bearingDeg, distanceM } from '@/lib/radio/coordinates'
import { wgs84ToSk42 } from '@/lib/radio/coordinates'
import { makeHgtBuffer } from '../../lib/radio/__tests__/terrain-helpers'
import type { PropagationResult } from '@/lib/radio/types'

const initial = () => useRadioStore.getState()

beforeEach(() => {
  // Сброс к исходному состоянию между тестами
  useRadioStore.setState({
    pointA: { lat: 55.7558, lon: 37.6173 },
    pointB: { lat: 55.8305, lon: 37.8501 },
    frequencyMhz: 2400,
    frequencyMode: 'single',
    freqFromMhz: 2400,
    freqToMhz: 2480,
    txHeightM: 30,
    rxHeightM: 10,
    kFactor: 4 / 3,
    climateZone: 'K',
    atmosphere: structuredClone(DEFAULT_ATMOSPHERE),
    equipment: structuredClone(DEFAULT_EQUIPMENT),
    // Детерминированный локальный движок: не зависит от сети/Pyodide в тестах
    model: 'fspl-p526',
    backend: 'wasm',
    backendAvailable: null,
    hgtTiles: [],
    clutter: null,
    calculating: false,
    result: null,
    budget: null,
    rangeResults: null,
    lastInput: null,
    lastError: null,
    terrainWarning: null,
    altitudeMode: 'single',
    altitudes: [500, 1000],
    dynamics: null,
    dynamicsAll: [],
    dynamicsParams: {
      altitudeM: 500,
      speedKmh: 150,
      initialElevationDeg: 5,
      initialAzimuthDeg: 90,
      trajectoryAzimuthDeg: 90,
      durationS: 300,
    },
    fpsMeasured: null,
    animationAllowed: null,
  })
})

describe('сеттеры состояния', () => {
  it('setPointA/setPointB', () => {
    initial().setPointA({ lat: 50, lon: 40 })
    initial().setPointB({ lat: 51, lon: 41 })
    expect(initial().pointA).toEqual({ lat: 50, lon: 40 })
    expect(initial().pointB).toEqual({ lat: 51, lon: 41 })
  })
  it('setField обновляет произвольное поле', () => {
    initial().setField('frequencyMhz', 900)
    expect(initial().frequencyMhz).toBe(900)
    initial().setField('altitudeMode', 'multi')
    expect(initial().altitudeMode).toBe('multi')
  })
  it('setEquipment мёрджит вложенные секции без потери остальных', () => {
    initial().setEquipment({ tx: { ...DEFAULT_EQUIPMENT.tx, gainDbi: 17 } })
    const eq = initial().equipment
    expect(eq.tx.gainDbi).toBe(17)
    expect(eq.rx.gainDbi).toBe(DEFAULT_EQUIPMENT.rx.gainDbi) // не тронута
    expect(eq.transmitter.powerDbm).toBe(DEFAULT_EQUIPMENT.transmitter.powerDbm)
  })
  it('setAtmosphere мёрджит поля атмосферы', () => {
    initial().setAtmosphere({ gases: true, rainRateMmH: 20 })
    const a = initial().atmosphere
    expect(a.gases).toBe(true)
    expect(a.rainRateMmH).toBe(20)
    expect(a.vegetation).toBe(false)
  })
  it('setDynamicsParams мёрджит параметры борта (высота и скорость остаются ручными)', () => {
    initial().setDynamicsParams({ speedKmh: 180 })
    const dp = initial().dynamicsParams
    expect(dp.speedKmh).toBe(180)
    expect(dp.altitudeM).toBe(500)
    expect(dp.durationS).toBe(300)
  })
  it('setAltitudes / setBackend / setHgtTiles', () => {
    initial().setAltitudes([100, 200, 300])
    expect(initial().altitudes).toEqual([100, 200, 300])
    initial().setBackend('http')
    expect(initial().backend).toBe('http')
  })
})

describe('СК-42 хелперы', () => {
  it('sk42Of / wgsFromSk42 взаимно обратны (точность ~3 м)', () => {
    const sk = sk42Of({ lat: 55.7558, lon: 37.6173 })
    const back = wgsFromSk42(sk)
    expect(distanceM({ lat: 55.7558, lon: 37.6173 }, back)).toBeLessThan(3)
  })
})

describe('addHgtTile: загрузка рельефа', () => {
  it('валидный тайл добавляется, demInfo обновляется', () => {
    const buf = makeHgtBuffer(1201, () => 250)
    const err = initial().addHgtTile(buf, 'N47E039.hgt')
    expect(err).toBeNull()
    expect(initial().hgtTiles).toHaveLength(1)
    expect(initial().hgtTiles[0].name).toBe('N47E039')
    expect(initial().demInfo).toContain('1')
  })
  it('повторная загрузка того же тайла заменяет его (без дублей)', () => {
    const buf = makeHgtBuffer(1201, () => 100)
    initial().addHgtTile(buf, 'N47E039.hgt')
    initial().addHgtTile(buf, 'N47E039.hgt')
    expect(initial().hgtTiles).toHaveLength(1)
  })
  it('битый файл возвращает текст ошибки и не меняет состояние', () => {
    const err = initial().addHgtTile(new ArrayBuffer(100), 'bad.hgt')
    expect(err).toBeTruthy()
    expect(initial().hgtTiles).toHaveLength(0)
  })
  it('setHgtTiles задаёт список целиком (имя источника — с количеством тайлов)', () => {
    const buf = makeHgtBuffer(1201, () => 10)
    initial().addHgtTile(buf, 'N47E039.hgt')
    initial().setHgtTiles([])
    expect(initial().hgtTiles).toHaveLength(0)
    expect(initial().demInfo).toContain('0')
  })
})

describe('applyDynamicsFromTrack: заполнение «от трассы»', () => {
  it('азимуты из трассы, длительность = длина/скорость, высота и скорость не трогаются', () => {
    const s = initial()
    const az = bearingDeg(s.pointA, s.pointB)
    const distKm = distanceM(s.pointA, s.pointB) / 1000
    const speedMs = s.dynamicsParams.speedKmh / 3.6
    s.applyDynamicsFromTrack()
    const dp = initial().dynamicsParams
    expect(dp.trajectoryAzimuthDeg).toBeCloseTo(Math.round(az * 10) / 10, 1)
    expect(dp.initialAzimuthDeg).toBeCloseTo(Math.round(az * 10) / 10, 1)
    expect(dp.initialElevationDeg).toBe(90) // старт над точкой A
    expect(dp.durationS).toBe(Math.round(distKm * 1000 / speedMs))
    // Ручные параметры не изменились
    expect(dp.altitudeM).toBe(500)
    expect(dp.speedKmh).toBe(150)
  })
  it('длительность клампится в 10…3600 с', () => {
    useRadioStore.setState({ dynamicsParams: { altitudeM: 500, speedKmh: 100, initialElevationDeg: 5, initialAzimuthDeg: 90, trajectoryAzimuthDeg: 90, durationS: 300 } })
    // Очень близкие точки → расчётная длительность < 10 с → кламп вниз
    useRadioStore.setState({ pointA: { lat: 55.7558, lon: 37.6173 }, pointB: { lat: 55.7559, lon: 37.6174 } })
    initial().applyDynamicsFromTrack()
    expect(initial().dynamicsParams.durationS).toBe(10)
    // Очень далёкие точки → кламп вверх (300 км при 100 км/ч ≫ 3600 с)
    useRadioStore.setState({ pointA: { lat: 40, lon: 30 }, pointB: { lat: 60, lon: 50 } })
    initial().applyDynamicsFromTrack()
    expect(initial().dynamicsParams.durationS).toBeLessThanOrEqual(3600)
  })
})

describe('calculate(): одиночная частота (wasm-бэкенд)', () => {
  it('заполняет result/budget/lastInput, снимает calculating', async () => {
    await initial().calculate()
    const s = initial()
    expect(s.lastError).toBeNull()
    expect(s.calculating).toBe(false)
    expect(s.result).not.toBeNull()
    expect(s.budget).not.toBeNull()
    expect(s.lastInput?.frequencyMhz).toBe(2400)
    expect(s.lastInput?.path.points[0]).toEqual(s.pointA)
    expect(s.lastCalculatedAt).not.toBeNull()
    // Запись в историю добавлена (IndexedDB)
    const { getDeviceId, listHistory } = await import('@/lib/radio/history')
    const history = await listHistory(getDeviceId())
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0].name).toContain('2400')
  })
  it('валидация: слишком короткая трасса → lastError без результата', async () => {
    useRadioStore.setState({ pointA: { lat: 55.7558, lon: 37.6173 }, pointB: { lat: 55.7558, lon: 37.6173 } })
    await initial().calculate()
    const s = initial()
    expect(s.lastError).toBeTruthy()
    expect(s.result).toBeNull()
  })
})

describe('calculate(): режим «диапазон частот»', () => {
  it('рассчитывает до 12 точек диапазона и среднюю частоту', async () => {
    useRadioStore.setState({ frequencyMode: 'range', freqFromMhz: 1000, freqToMhz: 1011 })
    await initial().calculate()
    const s = initial()
    expect(s.rangeResults).not.toBeNull()
    expect(s.rangeResults!.length).toBe(12)
    expect(s.rangeResults![0].frequencyMhz).toBe(1000)
    expect(s.rangeResults![s.rangeResults!.length - 1].frequencyMhz).toBe(1011)
    expect(s.result).not.toBeNull()
    // медиана диапазона в истории
    const { getDeviceId, listHistory } = await import('@/lib/radio/history')
    const history = await listHistory(getDeviceId())
    expect(history[0].name).toContain('диапазон')
    expect(history[0].frequencyMhz).toBe(1006) // центральная точка из 12 (индекс 6)
  })
})

describe('calculate(): предупреждение о покрытии рельефа', () => {
  it('трасса за пределами тайлов → terrainWarning с процентом', async () => {
    const buf = makeHgtBuffer(1201, () => 100)
    const err = initial().addHgtTile(buf, 'N47E039.hgt')
    expect(err).toBeNull()
    // трасса под Москвой, тайл — N47E039 → вне покрытия
    await initial().calculate()
    const s = initial()
    expect(s.terrainWarning).toBeTruthy()
    expect(s.terrainWarning).toContain('%')
    expect(s.terrainWarning).toContain('Загрузите соседние тайлы')
  })
  it('без тайлов предупреждения нет (demo-режим)', async () => {
    await initial().calculate()
    expect(initial().terrainWarning).toBeNull()
  })
})

describe('runDynamics(): динамика', () => {
  it('без результата расчёта — no-op', () => {
    initial().runDynamics()
    expect(initial().dynamics).toBeNull()
  })
  it('одна высота: результат из lastInput, aviation-режим', async () => {
    await initial().calculate()
    useRadioStore.setState({ dynamicsParams: { ...initial().dynamicsParams, altitudeM: 800, durationS: 120 } })
    initial().runDynamics()
    // runDynamics импортирует doppler асинхронно — ждём микротаски
    await vi.waitFor(() => expect(initial().dynamics).not.toBeNull())
    const d = initial().dynamics!
    expect(d.samples.length).toBeGreaterThan(10)
    // старт над Tx: наклонная = высота − (высота рельефа + антенна)
    const txBase = initial().lastInput?.path.profile[0]?.elev ?? 0
    expect(d.samples[0].slantM).toBeCloseTo(800 - txBase - 30, 1)
    expect(initial().dynamicsAll).toHaveLength(1)
  })
  it('многовысотный режим: по результату на каждую высоту, дедупликация', async () => {
    await initial().calculate()
    useRadioStore.setState({ altitudeMode: 'multi', altitudes: [500, 1000, 1000, 1500] })
    initial().runDynamics()
    await vi.waitFor(() => expect(initial().dynamicsAll.length).toBe(3))
    const heights = initial().dynamicsAll.map((d) => d.altitudeM)
    expect(heights).toEqual([500, 1000, 1500])
    // Первая высота — основной результат
    expect(initial().dynamics?.altitudeM).toBe(500)
  })
  it('невалидная высота (по схеме) даёт запись с ошибками валидации, не падает', async () => {
    await initial().calculate()
    useRadioStore.setState({ altitudeMode: 'multi', altitudes: [2] }) // 2 < 5 м
    initial().runDynamics()
    await vi.waitFor(() => expect(initial().dynamicsAll.length).toBe(1))
    expect(initial().dynamicsAll[0].samples).toHaveLength(0)
    expect(initial().dynamicsAll[0].warnings.length).toBeGreaterThan(0)
  })
})

describe('resetResults', () => {
  it('сбрасывает результаты, но не входные данные', async () => {
    await initial().calculate()
    initial().resetResults()
    const s = initial()
    expect(s.result).toBeNull()
    expect(s.budget).toBeNull()
    expect(s.rangeResults).toBeNull()
    expect(s.dynamics).toBeNull()
    expect(s.dynamicsAll).toEqual([])
    expect(s.lastError).toBeNull()
    expect(s.pointA).toEqual({ lat: 55.7558, lon: 37.6173 })
  })
})

describe('checkBackend', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('доступный бэкенд → backendAvailable=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    expect(await initial().checkBackend()).toBe(true)
    expect(initial().backendAvailable).toBe(true)
  })
  it('недоступный бэкенд → backendAvailable=false, без исключения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await initial().checkBackend()).toBe(false)
    expect(initial().backendAvailable).toBe(false)
  })
})
