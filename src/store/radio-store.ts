/**
 * Глобальное состояние калькулятора (zustand).
 */
'use client'

import { create } from 'zustand'
import type {
  AtmosphereParams,
  AvailabilityReport,
  BackendId,
  CalculationInput,
  DynamicsResult,
  DynamicParams,
  EquipmentParams,
  HistoryEntry,
  LatLon,
  LinkBudget,
  ModelId,
  PropagationResult,
  RangeFreqResult,
  RouteData,
} from '@/lib/radio/types'
import { createModel, defaultBackend } from '@/lib/radio/models'
import { computeLinkBudget } from '@/lib/radio/budget'
import { availabilityExpenseRow, computeAvailabilityReport } from '@/lib/radio/availability'
import { buildProfile, createHgtDem, createSyntheticDem, makeClutterSampler, parseHgt, pathTileCoverage, type ClutterGeoJson, type HgtTile } from '@/lib/radio/terrain'
import { distanceM, bearingDeg, wgs84ToSk42, sk42ToWgs84 } from '@/lib/radio/coordinates'
import { getDeviceId, saveHistory, syncEntry, listItuMaps, getItuMap, deleteItuMap } from '@/lib/radio/history'
import { calculationInputSchema, dynamicParamsSchema } from '@/lib/radio/validation'
import { parseRouteFile, routeDurationS } from '@/lib/radio/route'
import { ituEnvironmentAt, ituProductKey, type ItuGridSet } from '@/lib/radio/itu-env'
import type { ItuGrid } from '@/lib/radio/itu-grid'
import { LIMITS } from '@/lib/radio/constants'

export const DEFAULT_EQUIPMENT: EquipmentParams = {
  mode: 'simple',
  // Шумовое окружение по P.372 по умолчанию не учитывается (числа как раньше);
  // селектор в блоке приёмника включает Fa (существенна в нижней части диапазона)
  noiseEnvironment: 'none',
  tx: { gainDbi: 10, polarization: 'vertical' },
  rx: { gainDbi: 3, polarization: 'vertical' },
  transmitter: { powerDbm: 30, sensitivityDbm: -100 },
  receiver: { powerDbm: 0, sensitivityDbm: -100, noiseBandwidthHz: 1e6, noiseFigureDb: 3, modulation: 'QPSK', requiredEbN0Db: 9.6 },
}

export const DEFAULT_ATMOSPHERE: AtmosphereParams = {
  rainRateMmH: 0,
  gases: false,
  vegetation: false,
}

const MOSCOW_A: LatLon = { lat: 55.7558, lon: 37.6173 }
const MOSCOW_B: LatLon = { lat: 55.8305, lon: 37.8501 }

/** Максимум частот в диапазоне (режим «диапазон частот»). */
const MAX_RANGE_POINTS = 12

/** Список частот для режима «диапазон»: равномерные точки от/до с шагом. */
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

/** Построение input из текущего состояния. */
function buildInput(s: RadioState): CalculationInput {
  const dem = s.hgtTiles.length > 0 ? createHgtDem(s.hgtTiles) : createSyntheticDem()
  const clutterSampler = s.clutter ? makeClutterSampler(s.clutter) : undefined
  const profile = buildProfile(s.pointA, s.pointB, dem, clutterSampler)
  const dist = distanceM(s.pointA, s.pointB)

  // Условия из цифровых продуктов ITU-R P.2001-6: извлечение в точках трассы.
  // Загруженные продукты перекрывают ручные значения (R0.01 → дождь, DN_Median → k-фактор).
  const env = Object.keys(s.ituGrids).length > 0 ? ituEnvironmentAt(s.ituGrids, s.pointA, s.pointB) : null
  const ituRain = env?.rainRate001
  const ituK = env?.k50

  return {
    frequencyMhz: s.frequencyMhz,
    polarization: s.polarization,
    path: {
      points: [s.pointA, s.pointB],
      distanceM: dist,
      azimuthDeg: bearingDeg(s.pointA, s.pointB),
      profile,
      demStepM: dem.resolutionM,
      demSource: dem.name,
    },
    txHeightM: s.txHeightM,
    rxHeightM: s.rxHeightM,
    timePercents: [50, 90, 99, 99.9],
    kFactor: ituK ?? s.kFactor,
    kFactorSource: ituK !== undefined ? 'itu' : 'user',
    atmosphere: {
      ...s.atmosphere,
      rainRateMmH: ituRain ?? s.atmosphere.rainRateMmH,
      rainSource: ituRain !== undefined ? 'itu' : s.atmosphere.rainSource === 'itu' ? undefined : s.atmosphere.rainSource,
    },
    environment: env && env.usedProducts.length > 0 ? env : undefined,
    epsilon: 15,
    sigma: 0.005,
    climateZone: s.climateZone,
  }
}

export interface RadioState {
  // Ввод
  pointA: LatLon
  pointB: LatLon
  frequencyMhz: number
  /** Частота передатчика подвижной станции (обратная линия) */
  mobileFrequencyMhz: number
  /** Режим частоты наземного передатчика (прямая линия) */
  frequencyMode: 'single' | 'range'
  freqFromMhz: number
  freqToMhz: number
  /** Режим частоты подвижного передатчика (обратная линия) */
  mobileFrequencyMode: 'single' | 'range'
  mobileFreqFromMhz: number
  mobileFreqToMhz: number
  polarization: 'vertical' | 'horizontal' | 'circular'
  txHeightM: number
  rxHeightM: number
  kFactor: number
  climateZone: string
  atmosphere: AtmosphereParams
  equipment: EquipmentParams
  model: ModelId
  backend: BackendId
  backendAvailable: boolean | null

  // Рельеф
  hgtTiles: HgtTile[]
  clutter: ClutterGeoJson | null
  demInfo: string
  /** Подкачка тайлов SRTM с сервера (прогресс; null — не выполняется) */
  srtmSync: { done: number; total: number } | null

  // Цифровые продукты ITU-R P.2001-6 (Table 3): разобранные сетки + ошибки проверки
  ituGrids: ItuGridSet
  ituLoadErrors: Record<string, string>

  // Результаты
  calculating: boolean
  result: PropagationResult | null
  budget: LinkBudget | null
  /** Availability-отчёт P.530 для прямой линии */
  availability: AvailabilityReport | null
  /** Обратная линия: подвижный Tx → наземный Rx (одна частота) */
  reverseResult: PropagationResult | null
  reverseBudget: LinkBudget | null
  reverseInput: CalculationInput | null
  /** Availability-отчёт P.530 для обратной линии */
  reverseAvailability: AvailabilityReport | null
  /** Обратная линия в режиме «диапазон»: развёртка по частотам подвижного передатчика */
  reverseRangeResults: RangeFreqResult[] | null
  rangeResults: RangeFreqResult[] | null
  lastInput: CalculationInput | null
  lastError: string | null
  lastCalculatedAt: string | null
  terrainWarning: string | null

  // Динамика
  dynamicsParams: DynamicParams
  altitudeMode: 'single' | 'multi'
  altitudes: number[]
  /** Маршрут из файла траектории (вкладка «Динамика») */
  route: RouteData | null
  dynamics: DynamicsResult | null
  dynamicsAll: DynamicsResult[]
  fpsMeasured: number | null
  animationAllowed: boolean | null

  // Действия
  setPointA: (p: LatLon) => void
  setPointB: (p: LatLon) => void
  setField: <K extends keyof RadioState>(key: K, value: RadioState[K]) => void
  setEquipment: (eq: Partial<EquipmentParams>) => void
  setAtmosphere: (a: Partial<AtmosphereParams>) => void
  setDynamicsParams: (p: Partial<DynamicParams>) => void
  setBackend: (b: BackendId) => void
  setHgtTiles: (tiles: HgtTile[]) => void
  addHgtTile: (buffer: ArrayBuffer, filename: string) => string | null
  /** Докачка с сервера тайлов SRTM, покрывающих трассу, которых нет в кэше браузера. */
  fetchMissingSrtmTiles: () => Promise<{ downloaded: number }>
  setClutter: (gj: ClutterGeoJson | null) => void
  setAltitudes: (list: number[]) => void
  /** Разбор и добавление продукта ITU (после сохранения в кэш IndexedDB). */
  addItuGrid: (name: string, text: string) => Promise<{ ok: boolean; error?: string; info?: string }>
  /** Удаление продукта ITU из состояния и кэша. */
  removeItuGrid: (name: string) => Promise<void>
  /** Загрузка сохранённых карт ITU из IndexedDB и разбор всех продуктов. */
  loadItuMaps: () => Promise<void>
  applyDynamicsFromTrack: () => void
  /** Загрузка файла траектории: разбор + высота штатива → антенна наземной станции. */
  loadRoute: (fileName: string, text: string) => { ok: boolean; error?: string }
  /** Сброс маршрута из файла. */
  clearRoute: () => void
  checkBackend: () => Promise<boolean>
  calculate: () => Promise<void>
  runDynamics: () => void
  resetResults: () => void
}

export const useRadioStore = create<RadioState>((set, get) => ({
  pointA: MOSCOW_A,
  pointB: MOSCOW_B,
  frequencyMhz: 2400,
  mobileFrequencyMhz: 2400,
  frequencyMode: 'single',
  freqFromMhz: 2400,
  freqToMhz: 2480,
  mobileFrequencyMode: 'single',
  mobileFreqFromMhz: 2400,
  mobileFreqToMhz: 2480,
  polarization: 'vertical',
  txHeightM: 30,
  rxHeightM: 10,
  kFactor: 4 / 3,
  climateZone: 'K',
  atmosphere: DEFAULT_ATMOSPHERE,
  equipment: DEFAULT_EQUIPMENT,
  model: 'p2001',
  backend: defaultBackend(),
  backendAvailable: null,

  hgtTiles: [],
  clutter: null,
  demInfo: 'Синтетический рельеф (demo)',
  srtmSync: null,

  ituGrids: {},
  ituLoadErrors: {},

  calculating: false,
  result: null,
  budget: null,
  availability: null,
  reverseResult: null,
  reverseBudget: null,
  reverseInput: null,
  reverseAvailability: null,
  reverseRangeResults: null,
  rangeResults: null,
  lastInput: null,
  lastError: null,
  lastCalculatedAt: null,
  terrainWarning: null,

  dynamicsParams: {
    altitudeM: 500,
    speedKmh: 150,
    initialElevationDeg: 5,
    initialAzimuthDeg: 90,
    trajectoryAzimuthDeg: 90,
    durationS: 300,
  },
  altitudeMode: 'single',
  altitudes: [500, 1000],
  route: null,
  dynamics: null,
  dynamicsAll: [],
  fpsMeasured: null,
  animationAllowed: null,

  setPointA: (p) => set({ pointA: p }),
  setPointB: (p) => set({ pointB: p }),
  setField: (key, value) => set({ [key]: value } as Partial<RadioState>),
  setEquipment: (eq) => set((s) => ({ equipment: { ...s.equipment, ...eq } })),
  setAtmosphere: (a) => set((s) => ({ atmosphere: { ...s.atmosphere, ...a } })),
  setDynamicsParams: (p) => set((s) => ({ dynamicsParams: { ...s.dynamicsParams, ...p } })),
  setBackend: (b) => set({ backend: b }),

  setHgtTiles: (tiles) => {
    const dem = createHgtDem(tiles)
    set({ hgtTiles: tiles, demInfo: dem.name })
  },

  addHgtTile: (buffer, filename) => {
    try {
      const tile = parseHgt(buffer, filename)
      const others = get().hgtTiles.filter((t) => t.name !== tile.name)
      const tiles = [...others, tile]
      const dem = createHgtDem(tiles)
      set({ hgtTiles: tiles, demInfo: dem.name })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  setClutter: (gj) => set({ clutter: gj }),

  /** Докачка с сервера тайлов SRTM, покрывающих трассу A–Б, которых нет в кэше браузера.
   *  Тихая при недоступности бэкенда/IndexedDB; ошибки отдельных тайлов пропускаются. */
  fetchMissingSrtmTiles: async () => {
    const s = get()
    if (s.backendAvailable !== true) return { downloaded: 0 }
    const [{ requiredTilesForTrack }, { listSrtmTiles, putSrtmTile }, { apiUrl }] = await Promise.all([
      import('@/lib/radio/terrain'),
      import('@/lib/radio/history'),
      import('@/lib/radio/models/api'),
    ])
    let have: string[] = []
    try {
      have = await listSrtmTiles()
    } catch {
      // IndexedDB недоступна — подкачка невозможна
      return { downloaded: 0 }
    }
    const haveSet = new Set(have)
    const missing = requiredTilesForTrack(s.pointA, s.pointB).filter((n) => !haveSet.has(n))
    if (missing.length === 0) return { downloaded: 0 }

    set({ srtmSync: { done: 0, total: missing.length } })
    let downloaded = 0
    for (const name of missing) {
      try {
        const res = await fetch(apiUrl(`/srtm/${name}`), { signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        await putSrtmTile(name, buf)
        const err = get().addHgtTile(buf, `${name}.hgt`)
        if (err) console.warn(`Тайл ${name}: ${err}`)
        else downloaded++
      } catch (e) {
        console.warn(`Не удалось подтянуть тайл ${name} с сервера:`, e)
      }
      set((st) => ({ srtmSync: st.srtmSync ? { ...st.srtmSync, done: st.srtmSync.done + 1 } : null }))
    }
    set({ srtmSync: null })
    return { downloaded }
  },

  setAltitudes: (list) => set({ altitudes: list }),

  addItuGrid: async (name, text) => {
    const { parseItuGrid, ItuGridParseError, validateItuFile } = await import('@/lib/radio/itu-grid')
    const v = validateItuFile(name, text)
    if (!v.ok) {
      set((s) => ({ ituLoadErrors: { ...s.ituLoadErrors, [name]: v.error ?? 'ошибка' } }))
      return { ok: false, error: v.error }
    }
    try {
      const grid = parseItuGrid(name, text)
      set((s) => ({
        ituGrids: { ...s.ituGrids, [grid.spec.name]: grid },
        ituLoadErrors: Object.fromEntries(Object.entries(s.ituLoadErrors).filter(([k]) => k !== name && k !== grid.spec.name)),
      }))
      return { ok: true, info: v.info }
    } catch (e) {
      const err = e instanceof ItuGridParseError || e instanceof Error ? e.message : String(e)
      set((s) => ({ ituLoadErrors: { ...s.ituLoadErrors, [name]: err } }))
      return { ok: false, error: err }
    }
  },

  removeItuGrid: async (name) => {
    const key = ituProductKey(name) ?? name
    set((s) => {
      const grids = { ...s.ituGrids }
      delete grids[key]
      delete grids[name]
      const errs = { ...s.ituLoadErrors }
      delete errs[key]
      delete errs[name]
      return { ituGrids: grids, ituLoadErrors: errs }
    })
    try {
      await deleteItuMap(name)
    } catch {
      // кэш недоступен — не критично
    }
  },

  loadItuMaps: async () => {
    try {
      const stored = await listItuMaps()
      const grids: Record<string, ItuGrid> = {}
      const errors: Record<string, string> = {}
      const { parseItuGrid, validateItuFile } = await import('@/lib/radio/itu-grid')
      for (const { name } of stored) {
        const text = await getItuMap(name)
        if (text === null) continue
        const v = validateItuFile(name, text)
        if (!v.ok) {
          errors[name] = v.error ?? 'ошибка проверки'
          continue
        }
        try {
          const grid = parseItuGrid(name, text)
          grids[grid.spec.name] = grid
        } catch {
          // повреждённая сетка пропускается
        }
      }
      // Слияние (а не перезапись): свежие продукты, добавленные до завершения
      // фоновой загрузки кэша, не теряются
      set((s) => ({ ituGrids: { ...grids, ...s.ituGrids }, ituLoadErrors: { ...s.ituLoadErrors, ...errors } }))
    } catch {
      // IndexedDB недоступна — игнорируем
    }
  },

  /** Заполнение параметров динамики по трассе: вручную остаются только высота и скорость. */
  applyDynamicsFromTrack: () => {
    const s = get()
    const az = bearingDeg(s.pointA, s.pointB)
    const dist = distanceM(s.pointA, s.pointB)
    const speedMs = s.dynamicsParams.speedKmh / 3.6
    const durationS = Math.max(10, Math.min(3600, Math.round(dist / speedMs)))
    set({
      dynamicsParams: {
        ...s.dynamicsParams,
        trajectoryAzimuthDeg: Math.round(az * 10) / 10,
        initialAzimuthDeg: Math.round(az * 10) / 10,
        initialElevationDeg: 90,
        durationS,
      },
    })
  },

  /** Загрузка файла траектории: разбор, применение высоты штатива к антенне наземной станции. */
  loadRoute: (fileName, text) => {
    const res = parseRouteFile(text, fileName)
    if (!res.ok) return { ok: false, error: `${fileName}: ${res.error}` }
    const pts = res.data.points
    set((s) => ({
      route: res.data,
      // Концы траектории → трасса A–Б основного расчёта
      pointA: { lat: pts[0].lat, lon: pts[0].lon },
      pointB: { lat: pts[pts.length - 1].lat, lon: pts[pts.length - 1].lon },
      // tripodHeight из файла — высота антенны на штативе наземной станции; 0 клампим к минимуму
      txHeightM: Math.max(0.5, res.data.tripodHeightM),
      // результаты динамики устарели
      dynamics: null,
      dynamicsAll: [],
      fpsMeasured: null,
      animationAllowed: null,
    }))
    return { ok: true }
  },

  clearRoute: () =>
    set({ route: null, dynamics: null, dynamicsAll: [], fpsMeasured: null, animationAllowed: null }),

  checkBackend: async () => {
    const { apiUrl } = await import('@/lib/radio/models/api')
    try {
      const res = await fetch(apiUrl('/health'), { signal: AbortSignal.timeout(4000) })
      const ok = res.ok
      set({ backendAvailable: ok })
      return ok
    } catch {
      set({ backendAvailable: false })
      return false
    }
  },

  calculate: async () => {
    const s = get()
    set({ calculating: true, lastError: null, terrainWarning: null })

    try {
      // Автоподкачка тайлов рельефа, покрывающих трассу, с сервера (тихо при
      // недоступности; после подкачки берём свежий стейт с новыми hgtTiles)
      await get().fetchMissingSrtmTiles()
      const sAfterSrtm = get()
      const baseInput = buildInput(sAfterSrtm)

      // Проверка покрытия трассы загруженными тайлами рельефа
      if (sAfterSrtm.hgtTiles.length > 0) {
        const cov = pathTileCoverage(baseInput.path.profile, baseInput.path.points, sAfterSrtm.hgtTiles)
        if (cov.outside) {
          const pct = Math.max(0, Math.round((1 - cov.insideRatio) * 100))
          set({
            terrainWarning: `Часть трассы (${pct}% точек профиля) выходит за пределы загруженных тайлов рельефа — вне тайлов высота принята 0 м. Загрузите соседние тайлы .hgt для точного расчёта.`,
          })
        }
      }

      // Валидация
      const parsed = calculationInputSchema.safeParse(baseInput)
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        set({ calculating: false, lastError: errors.join('; ') })
        return
      }

      const model = createModel(s.backend, s.model)

      // Обратная линия (подвижный Tx → наземный Rx): передаёт подвижная станция —
      // её антенна и мощность; параметры приёмника (NF, полоса, модуляция) общие —
      // одна радиосистема.
      const reverseEquipment: EquipmentParams = {
        mode: s.equipment.mode,
        tx: s.equipment.rx,
        rx: s.equipment.tx,
        transmitter: { ...s.equipment.transmitter, powerDbm: s.equipment.receiver.powerDbm },
        receiver: { ...s.equipment.receiver, sensitivityDbm: s.equipment.transmitter.sensitivityDbm },
      }
      const calcReverse = async (f: number) => {
        const revInput: CalculationInput = { ...baseInput, frequencyMhz: f }
        const revParsed = calculationInputSchema.safeParse(revInput)
        if (!revParsed.success) return null
        const revProp = await model.calculate(revInput)
        return { input: revInput, prop: revProp, budget: computeLinkBudget(revInput, reverseEquipment, revProp) }
      }

      let result: PropagationResult
      let budget: LinkBudget
      let lastInput: CalculationInput
      let rangeResults: RangeFreqResult[] | null = null
      let historyName: string
      let historyFreq: number

      // Прямая линия: одна частота или развёртка по диапазону
      if (s.frequencyMode === 'range') {
        const freqs = buildFreqList(s.freqFromMhz, s.freqToMhz)
        rangeResults = []
        let mainProp: PropagationResult | null = null
        let mainBudget: LinkBudget | null = null
        let mainInput: CalculationInput | null = null
        for (const f of freqs) {
          const input: CalculationInput = { ...baseInput, frequencyMhz: f }
          const prop = await model.calculate(input)
          const b = computeLinkBudget(input, s.equipment, prop)
          rangeResults.push({
            frequencyMhz: f,
            medianLossDb: prop.medianLossDb,
            linkMarginDb: b.linkMarginDb,
            prxDbm: b.prxDbm,
            snrDb: b.snrDb,
          })
          if (mainProp === null) {
            mainProp = prop
            mainBudget = b
            mainInput = input
          }
        }
        // Основной результат — средняя частота диапазона
        const midIdx = Math.floor(freqs.length / 2)
        if (midIdx > 0 && midIdx < freqs.length) {
          const midInput: CalculationInput = { ...baseInput, frequencyMhz: freqs[midIdx] }
          mainInput = midInput
          mainProp = await model.calculate(midInput)
          mainBudget = computeLinkBudget(midInput, s.equipment, mainProp)
        }
        result = mainProp!
        budget = mainBudget!
        lastInput = mainInput!
        historyName = `${freqs[0].toFixed(0)}–${freqs[freqs.length - 1].toFixed(0)} МГц (диапазон), ${(lastInput.path.distanceM / 1000).toFixed(1)} км`
        historyFreq = freqs[midIdx]
      } else {
        // Обычный режим: одна частота
        const prop = await model.calculate(baseInput)
        result = prop
        budget = computeLinkBudget(baseInput, s.equipment, prop)
        lastInput = baseInput
        historyName = `${(lastInput.path.distanceM / 1000).toFixed(1)} км @ ${s.frequencyMhz} МГц`
        historyFreq = s.frequencyMhz
      }

      // Availability-отчёт (P.530) для прямой линии: считается поверх бюджета,
      // прогноз недоступности добавляется строкой в расход (попадает в историю и PDF)
      let availability: AvailabilityReport | null = null
      const fwdReport = computeAvailabilityReport(lastInput, budget)
      if (fwdReport) {
        availability = fwdReport
        budget = { ...budget, expense: [...budget.expense, availabilityExpenseRow(fwdReport)] }
      }

      // Обратная линия: по режиму частоты подвижного передатчика
      let reverseResult: PropagationResult | null = null
      let reverseBudget: LinkBudget | null = null
      let reverseInput: CalculationInput | null = null
      let reverseAvailability: AvailabilityReport | null = null
      let reverseRangeResults: RangeFreqResult[] | null = null
      if (s.mobileFrequencyMode === 'range') {
        const freqs = buildFreqList(s.mobileFreqFromMhz, s.mobileFreqToMhz)
        reverseRangeResults = []
        for (const f of freqs) {
          const r = await calcReverse(f)
          if (r) {
            reverseRangeResults.push({
              frequencyMhz: f,
              medianLossDb: r.prop.medianLossDb,
              linkMarginDb: r.budget.linkMarginDb,
              prxDbm: r.budget.prxDbm,
              snrDb: r.budget.snrDb,
            })
          }
        }
      } else {
        const mf = s.mobileFrequencyMhz
        if (
          mf >= LIMITS.frequencyMinMhz &&
          mf <= LIMITS.frequencyMaxMhz &&
          Math.abs(mf - lastInput.frequencyMhz) > 1e-9
        ) {
          const r = await calcReverse(mf)
          if (r) {
            reverseResult = r.prop
            reverseBudget = r.budget
            reverseInput = r.input
          }
        }
      }
      if (reverseInput && reverseBudget) {
        const revReport = computeAvailabilityReport(reverseInput, reverseBudget)
        if (revReport) {
          reverseAvailability = revReport
          reverseBudget = { ...reverseBudget, expense: [...reverseBudget.expense, availabilityExpenseRow(revReport)] }
        }
      }

      set({
        result,
        budget,
        availability,
        reverseResult,
        reverseBudget,
        reverseInput,
        reverseAvailability,
        reverseRangeResults,
        rangeResults,
        lastInput,
        calculating: false,
        lastCalculatedAt: new Date().toISOString(),
      })

      // История: IndexedDB + синхронизация
      try {
        const entry: Omit<HistoryEntry, 'id' | 'synced'> = {
          deviceId: getDeviceId(),
          createdAt: new Date().toISOString(),
          name: historyName,
          model: s.model,
          engineUsed: result.engineUsed,
          backend: s.backend,
          frequencyMhz: historyFreq,
          distanceKm: lastInput.path.distanceM / 1000,
          medianLossDb: result.medianLossDb,
          linkMarginDb: budget.linkMarginDb,
          input: lastInput,
          budget,
          // Снимок параметров линка: полное восстановление формы из истории
          linkParams: {
            frequencyMode: s.frequencyMode,
            freqFromMhz: s.freqFromMhz,
            freqToMhz: s.freqToMhz,
            mobileFrequencyMhz: s.mobileFrequencyMhz,
            mobileFrequencyMode: s.mobileFrequencyMode,
            mobileFreqFromMhz: s.mobileFreqFromMhz,
            mobileFreqToMhz: s.mobileFreqToMhz,
            equipment: s.equipment,
          },
        }
        const saved = await saveHistory(entry)
        void syncEntry(saved)
      } catch {
        // История — не критичный путь
      }
    } catch (e) {
      set({ calculating: false, lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  runDynamics: () => {
    const s = get()
    if (!s.result || !s.budget) return
    const input = s.lastInput ?? buildInput(s)

    // Список высот: одна или несколько
    const heights = s.altitudeMode === 'multi'
      ? Array.from(new Set(s.altitudes.map((a) => Math.round(a))))
      : [s.dynamicsParams.altitudeM]

    const opts = {
      powerDbm: s.equipment.transmitter.powerDbm,
      txGainDbi: s.equipment.tx.gainDbi,
      rxGainDbi: s.equipment.rx.gainDbi,
      sensitivityDbm: s.equipment.receiver.sensitivityDbm,
      noiseBandwidthHz: s.equipment.receiver.noiseBandwidthHz ?? 1e6,
      noiseFigureDb: s.equipment.receiver.noiseFigureDb ?? 3,
      modulation: (s.equipment.receiver.modulation ?? 'QPSK') as 'BPSK' | 'QPSK' | '16QAM' | '64QAM',
    }

    import('@/lib/radio/doppler').then(({ simulateDynamics }) => {
      const all: DynamicsResult[] = []
      if (s.route) {
        // Маршрут из файла: один прогон, высота/скорость/длительность из файла
        const dp: DynamicParams = {
          ...s.dynamicsParams,
          altitudeM: s.route.points[0].altitudeM,
          durationS: routeDurationS(s.route),
        }
        const dyn = simulateDynamics({ ...input, aviation: true }, dp, opts, s.route)
        all.push({ ...dyn, label: 'По маршруту' })
      } else {
        for (const h of heights) {
          const dp: DynamicParams = { ...s.dynamicsParams, altitudeM: h }
          const parsed = dynamicParamsSchema.safeParse(dp)
          if (!parsed.success) {
            all.push({
              samples: [],
              maxDopplerHz: 0,
              minMarginDb: 0,
              exitTimeS: null,
              warnings: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
              altitudeM: h,
            })
            continue
          }
          const dyn = simulateDynamics({ ...input, aviation: true }, dp, opts)
          all.push({ ...dyn, altitudeM: h })
        }
      }
      set({ dynamics: all[0] ?? null, dynamicsAll: all, fpsMeasured: null, animationAllowed: null })
    })
  },

  resetResults: () => set({ result: null, budget: null, availability: null, reverseResult: null, reverseBudget: null, reverseInput: null, reverseAvailability: null, reverseRangeResults: null, rangeResults: null, dynamics: null, dynamicsAll: [], lastError: null }),
}))

/** СК-42 для точки (для отображения в UI). */
export function sk42Of(p: LatLon) {
  return wgs84ToSk42(p)
}

/** WGS84 из СК-42. */
export function wgsFromSk42(sk: { zone: number; x: number; y: number }) {
  return sk42ToWgs84(sk)
}
