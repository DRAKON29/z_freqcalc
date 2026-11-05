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
} from '@/lib/radio/types'
import { createModel, defaultBackend } from '@/lib/radio/models'
import { computeLinkBudget } from '@/lib/radio/budget'
import { buildProfile, createHgtDem, createSyntheticDem, makeClutterSampler, parseHgt, type ClutterGeoJson, type HgtTile } from '@/lib/radio/terrain'
import { distanceM, bearingDeg, wgs84ToSk42, sk42ToWgs84 } from '@/lib/radio/coordinates'
import { getDeviceId, saveHistory, syncEntry } from '@/lib/radio/history'
import { calculationInputSchema, dynamicParamsSchema } from '@/lib/radio/validation'

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
  lastInput: CalculationInput | null
  lastError: string | null
  lastCalculatedAt: string | null

  // Динамика
  dynamicsParams: DynamicParams
  dynamics: DynamicsResult | null
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
  checkBackend: () => Promise<boolean>
  calculate: () => Promise<void>
  runDynamics: () => void
  resetResults: () => void
}

export const useRadioStore = create<RadioState>((set, get) => ({
  pointA: MOSCOW_A,
  pointB: MOSCOW_B,
  frequencyMhz: 2400,
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
  lastInput: null,
  lastError: null,
  lastCalculatedAt: null,

  dynamicsParams: {
    altitudeM: 500,
    speedKmh: 150,
    initialElevationDeg: 5,
    initialAzimuthDeg: 90,
    trajectoryAzimuthDeg: 90,
    durationS: 300,
  },
  dynamics: null,
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
    set({ calculating: true, lastError: null })

    try {
      const input = buildInput(s)

      // Валидация (ТЗ 3.4)
      const parsed = calculationInputSchema.safeParse(input)
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        set({ calculating: false, lastError: errors.join('; ') })
        return
      }

      const model = createModel(s.backend, s.model)
      const prop = await model.calculate(input)
      const budget = computeLinkBudget(input, s.equipment, prop)

      set({
        result: prop,
        budget,
        lastInput: input,
        calculating: false,
        lastCalculatedAt: new Date().toISOString(),
      })

      // История (ТЗ 4.9): IndexedDB + синхронизация
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
    const dp = s.dynamicsParams

    const parsed = dynamicParamsSchema.safeParse(dp)
    if (!parsed.success) {
      set({
        dynamics: {
          samples: [],
          maxDopplerHz: 0,
          minMarginDb: 0,
          exitTimeS: null,
          warnings: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      })
      return
    }

    import('@/lib/radio/doppler').then(({ simulateDynamics }) => {
      const dyn = simulateDynamics(
        { ...input, aviation: true },
        dp,
        {
          powerDbm: s.equipment.transmitter.powerDbm,
          txGainDbi: s.equipment.tx.gainDbi,
          rxGainDbi: s.equipment.rx.gainDbi,
          sensitivityDbm: s.equipment.receiver.sensitivityDbm,
          noiseBandwidthHz: s.equipment.receiver.noiseBandwidthHz ?? 1e6,
          noiseFigureDb: s.equipment.receiver.noiseFigureDb ?? 3,
          modulation: (s.equipment.receiver.modulation ?? 'QPSK') as 'BPSK' | 'QPSK' | '16QAM' | '64QAM',
        },
      )
      set({ dynamics: dyn, fpsMeasured: null, animationAllowed: null })
    })
  },

  resetResults: () => set({ result: null, budget: null, dynamics: null, lastError: null }),
}))

/** СК-42 для точки (для отображения в UI). */
export function sk42Of(p: LatLon) {
  return wgs84ToSk42(p)
}

/** WGS84 из СК-42. */
export function wgsFromSk42(sk: { zone: number; x: number; y: number }) {
  return sk42ToWgs84(sk)
}
