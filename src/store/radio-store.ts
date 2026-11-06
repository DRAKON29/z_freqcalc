/**
 * Глобальное состояние калькулятора (zustand).
 */
'use client'

import { create } from 'zustand'
import type {
  AtmosphereParams,
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
} from '@/lib/radio/types'
import { createModel, defaultBackend } from '@/lib/radio/models'
import { computeLinkBudget } from '@/lib/radio/budget'
import { buildProfile, createHgtDem, createSyntheticDem, makeClutterSampler, parseHgt, pathTileCoverage, type ClutterGeoJson, type HgtTile } from '@/lib/radio/terrain'
import { distanceM, bearingDeg, wgs84ToSk42, sk42ToWgs84 } from '@/lib/radio/coordinates'
import { getDeviceId, saveHistory, syncEntry } from '@/lib/radio/history'
import { calculationInputSchema, dynamicParamsSchema } from '@/lib/radio/validation'
import { LIMITS } from '@/lib/radio/constants'

export const DEFAULT_EQUIPMENT: EquipmentParams = {
  mode: 'simple',
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
    kFactor: s.kFactor,
    atmosphere: s.atmosphere,
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
  frequencyMode: 'single' | 'range'
  freqFromMhz: number
  freqToMhz: number
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

  // Результаты
  calculating: boolean
  result: PropagationResult | null
  budget: LinkBudget | null
  /** Обратная линия: подвижный Tx → наземный Rx (только режим «одна частота») */
  reverseResult: PropagationResult | null
  reverseBudget: LinkBudget | null
  reverseInput: CalculationInput | null
  rangeResults: RangeFreqResult[] | null
  lastInput: CalculationInput | null
  lastError: string | null
  lastCalculatedAt: string | null
  terrainWarning: string | null

  // Динамика
  dynamicsParams: DynamicParams
  altitudeMode: 'single' | 'multi'
  altitudes: number[]
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
  setClutter: (gj: ClutterGeoJson | null) => void
  setAltitudes: (list: number[]) => void
  applyDynamicsFromTrack: () => void
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

  calculating: false,
  result: null,
  budget: null,
  reverseResult: null,
  reverseBudget: null,
  reverseInput: null,
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

  setAltitudes: (list) => set({ altitudes: list }),

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
      const baseInput = buildInput(s)

      // Проверка покрытия трассы загруженными тайлами рельефа
      if (s.hgtTiles.length > 0) {
        const cov = pathTileCoverage(baseInput.path.profile, baseInput.path.points, s.hgtTiles)
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

      // Режим «диапазон частот»: расчёт по списку частот
      if (s.frequencyMode === 'range') {
        const freqs = buildFreqList(s.freqFromMhz, s.freqToMhz)
        const rangeResults: RangeFreqResult[] = []
        let mainProp: PropagationResult | null = null
        let mainBudget: LinkBudget | null = null
        let mainInput: CalculationInput | null = null
        for (const f of freqs) {
          const input: CalculationInput = { ...baseInput, frequencyMhz: f }
          const prop = await model.calculate(input)
          const budget = computeLinkBudget(input, s.equipment, prop)
          rangeResults.push({
            frequencyMhz: f,
            medianLossDb: prop.medianLossDb,
            linkMarginDb: budget.linkMarginDb,
            prxDbm: budget.prxDbm,
            snrDb: budget.snrDb,
          })
          if (mainProp === null) {
            mainProp = prop
            mainBudget = budget
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
        set({
          result: mainProp,
          budget: mainBudget,
          reverseResult: null,
          reverseBudget: null,
          reverseInput: null,
          rangeResults,
          lastInput: mainInput,
          calculating: false,
          lastCalculatedAt: new Date().toISOString(),
        })

        // История
        try {
          const entry: Omit<HistoryEntry, 'id' | 'synced'> = {
            deviceId: getDeviceId(),
            createdAt: new Date().toISOString(),
            name: `${freqs[0].toFixed(0)}–${freqs[freqs.length - 1].toFixed(0)} МГц (диапазон), ${(mainInput!.path.distanceM / 1000).toFixed(1)} км`,
            model: s.model,
            engineUsed: mainProp!.engineUsed,
            backend: s.backend,
            frequencyMhz: freqs[midIdx],
            distanceKm: mainInput!.path.distanceM / 1000,
            medianLossDb: mainProp!.medianLossDb,
            linkMarginDb: mainBudget!.linkMarginDb,
            input: mainInput!,
            budget: mainBudget!,
          }
          const saved = await saveHistory(entry)
          void syncEntry(saved)
        } catch {
          // История — не критичный путь
        }
        return
      }

      // Обычный режим: одна частота
      const input = baseInput
      const prop = await model.calculate(input)
      const budget = computeLinkBudget(input, s.equipment, prop)

      // Обратная линия: подвижный Tx → наземный Rx на частоте подвижного передатчика.
      // Параметры приёмника (NF, полоса, модуляция) общие — одна радиосистема.
      let reverseResult: PropagationResult | null = null
      let reverseBudget: LinkBudget | null = null
      let reverseInput: CalculationInput | null = null
      const mf = s.mobileFrequencyMhz
      if (
        mf >= LIMITS.frequencyMinMhz &&
        mf <= LIMITS.frequencyMaxMhz &&
        Math.abs(mf - input.frequencyMhz) > 1e-9
      ) {
        const revInput: CalculationInput = { ...input, frequencyMhz: mf }
        const revParsed = calculationInputSchema.safeParse(revInput)
        if (revParsed.success) {
          const revProp = await model.calculate(revInput)
          const revEquipment: EquipmentParams = {
            mode: s.equipment.mode,
            // передаёт подвижная станция: её антенна и мощность
            tx: s.equipment.rx,
            rx: s.equipment.tx,
            transmitter: { ...s.equipment.transmitter, powerDbm: s.equipment.receiver.powerDbm },
            receiver: { ...s.equipment.receiver, sensitivityDbm: s.equipment.transmitter.sensitivityDbm },
          }
          reverseResult = revProp
          reverseBudget = computeLinkBudget(revInput, revEquipment, revProp)
          reverseInput = revInput
        }
      }

      set({
        result: prop,
        budget,
        reverseResult,
        reverseBudget,
        reverseInput,
        rangeResults: null,
        lastInput: input,
        calculating: false,
        lastCalculatedAt: new Date().toISOString(),
      })

      // История: IndexedDB + синхронизация
      try {
        const entry: Omit<HistoryEntry, 'id' | 'synced'> = {
          deviceId: getDeviceId(),
          createdAt: new Date().toISOString(),
          name: `${(input.path.distanceM / 1000).toFixed(1)} км @ ${s.frequencyMhz} МГц`,
          model: s.model,
          engineUsed: prop.engineUsed,
          backend: s.backend,
          frequencyMhz: s.frequencyMhz,
          distanceKm: input.path.distanceM / 1000,
          medianLossDb: prop.medianLossDb,
          linkMarginDb: budget.linkMarginDb,
          input,
          budget,
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
      set({ dynamics: all[0] ?? null, dynamicsAll: all, fpsMeasured: null, animationAllowed: null })
    })
  },

  resetResults: () => set({ result: null, budget: null, reverseResult: null, reverseBudget: null, reverseInput: null, rangeResults: null, dynamics: null, dynamicsAll: [], lastError: null }),
}))

/** СК-42 для точки (для отображения в UI). */
export function sk42Of(p: LatLon) {
  return wgs84ToSk42(p)
}

/** WGS84 из СК-42. */
export function wgsFromSk42(sk: { zone: number; x: number; y: number }) {
  return sk42ToWgs84(sk)
}
