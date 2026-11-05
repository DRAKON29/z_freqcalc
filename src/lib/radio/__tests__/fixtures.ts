/**
 * Фабрики входных данных для тестов: CalculationInput, профиль, бюджет.
 */
import type { CalculationInput, EquipmentParams, HistoryEntry } from '../types'
import { DEFAULT_EQUIPMENT } from '@/store/radio-store'

/** Плоский профиль: высота 0, N точек. */
export function flatProfile(distanceM: number, n = 21) {
  const pts: { d: number; elev: number; clutter: number; total: number }[] = []
  for (let i = 0; i < n; i++) {
    const d = (distanceM * i) / (n - 1)
    pts.push({ d, elev: 0, clutter: 0, total: 0 })
  }
  return pts
}

/** Профиль с одним препятствием в середине. */
export function ridgeProfile(distanceM: number, ridgeH: number, n = 41) {
  const pts: { d: number; elev: number; clutter: number; total: number }[] = []
  for (let i = 0; i < n; i++) {
    const d = (distanceM * i) / (n - 1)
    const elev = Math.max(0, ridgeH - (Math.abs(d / distanceM - 0.5) * distanceM) / 10)
    pts.push({ d, elev, clutter: 0, total: elev })
  }
  return pts
}

export function makeInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  const distanceM = overrides.path?.distanceM ?? 30_000
  const base: CalculationInput = {
    frequencyMhz: 2000,
    polarization: 'vertical',
    path: {
      points: [
        { lat: 55.7558, lon: 37.6173 },
        { lat: 55.9, lon: 38.0 },
      ],
      distanceM,
      azimuthDeg: 65,
      profile: flatProfile(distanceM),
      demStepM: 30,
      demSource: 'Тестовый DEM',
    },
    txHeightM: 30,
    rxHeightM: 10,
    timePercents: [50, 90, 99, 99.9],
    kFactor: 4 / 3,
    atmosphere: { rainRateMmH: 0, gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }
  return { ...base, ...overrides, path: { ...base.path, ...(overrides.path ?? {}) } }
}

export function makeEquipment(overrides: Partial<EquipmentParams> = {}): EquipmentParams {
  return {
    ...structuredClone(DEFAULT_EQUIPMENT),
    ...overrides,
    tx: { ...structuredClone(DEFAULT_EQUIPMENT.tx), ...(overrides.tx ?? {}) },
    rx: { ...structuredClone(DEFAULT_EQUIPMENT.rx), ...(overrides.rx ?? {}) },
    transmitter: { ...structuredClone(DEFAULT_EQUIPMENT.transmitter), ...(overrides.transmitter ?? {}) },
    receiver: { ...structuredClone(DEFAULT_EQUIPMENT.receiver), ...(overrides.receiver ?? {}) },
  }
}

/** Минимальная запись истории для тестов PDF/CSV/IndexedDB. */
export function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const input = makeInput()
  return {
    deviceId: 'test-device',
    createdAt: '2026-01-15T10:30:00.000Z',
    name: '30.0 км @ 2000 МГц',
    model: 'fspl-p526',
    engineUsed: 'TS: FSPL (P.525) + P.526 + P.838/P.676/P.833',
    backend: 'wasm',
    frequencyMhz: 2000,
    distanceKm: input.path.distanceM / 1000,
    medianLossDb: 128.5,
    linkMarginDb: 12.3,
    input,
    budget: {
      eirpDbm: 40,
      pathLossDb: 128.5,
      prxDbm: -85.5,
      noisePowerDbm: -110.97,
      ktbDbm: -113.97,
      nfDb: 3,
      snrDb: 25.5,
      ebN0ActualDb: 25.5,
      ebN0RequiredDb: 9.6,
      linkMarginDb: 12.3,
      income: [],
      expense: [],
    },
    synced: false,
    ...overrides,
  }
}
