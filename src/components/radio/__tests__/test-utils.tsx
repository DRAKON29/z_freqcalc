/**
 * Общие утилиты компонентных тестов: сброс store, фабрика результатов.
 */
import { useRadioStore, DEFAULT_EQUIPMENT, DEFAULT_ATMOSPHERE } from '@/store/radio-store'
import type { PropagationResult, LinkBudget, CalculationInput } from '@/lib/radio/types'
import { makeInput } from '../../../lib/radio/__tests__/fixtures'
import { computeFsplP526 } from '@/lib/radio/p2001lite'

/** Полный сброс состояния store к исходному. */
export function resetStore() {
  useRadioStore.setState({
    pointA: { lat: 55.7558, lon: 37.6173 },
    pointB: { lat: 55.8305, lon: 37.8501 },
    frequencyMhz: 2400,
    frequencyMode: 'single',
    freqFromMhz: 2400,
    freqToMhz: 2480,
    polarization: 'vertical',
    txHeightM: 30,
    rxHeightM: 10,
    kFactor: 4 / 3,
    climateZone: 'K',
    atmosphere: structuredClone(DEFAULT_ATMOSPHERE),
    equipment: structuredClone(DEFAULT_EQUIPMENT),
    model: 'p2001',
    backend: 'wasm',
    backendAvailable: null,
    hgtTiles: [],
    clutter: null,
    demInfo: 'Синтетический рельеф (demo)',
    calculating: false,
    result: null,
    budget: null,
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
  })
}

export function fakeResult(input?: CalculationInput): { result: PropagationResult; budget: LinkBudget; lastInput: CalculationInput } {
  const inp = input ?? makeInput({ frequencyMhz: 2400 })
  const result = computeFsplP526(inp)
  const budget: LinkBudget = {
    eirpDbm: 40,
    pathLossDb: result.medianLossDb,
    prxDbm: -85,
    noisePowerDbm: -110.97,
    ktbDbm: -113.97,
    nfDb: 3,
    snrDb: 25.97,
    ebN0ActualDb: 25.97,
    ebN0RequiredDb: 9.6,
    linkMarginDb: 16.37,
    income: [
      { label: 'Мощность передатчика (P_tx)', value: 30, unit: 'дБм', sign: '+' },
      { label: 'Усиление антенны Tx (G_tx)', value: 10, unit: 'дБи', sign: '+' },
      { label: 'ЭИИМ (EIRP)', value: 40, unit: 'дБм', sign: '=' },
    ],
    expense: [
      { label: 'Мощность сигнала (P_rx)', value: -85, unit: 'дБм', sign: '=' },
      { label: 'SNR', value: 25.97, unit: 'дБ', sign: '=' },
      { label: 'Link margin', value: 16.37, unit: 'дБ', sign: '=' },
    ],
  }
  return { result, budget, lastInput: inp }
}

/** Заполнить store готовым результатом (для панелей, требующих расчёт). */
export function seedResult() {
  const { result, budget, lastInput } = fakeResult()
  useRadioStore.setState({ result, budget, lastInput, lastCalculatedAt: new Date().toISOString() })
}
