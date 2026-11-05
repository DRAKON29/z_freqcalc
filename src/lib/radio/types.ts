/**
 * Общие типы калькулятора распространения радиоволн.
 * Соответствуют ТЗ v1.0 (разделы 3.1, 4.1–4.9).
 */

export type Polarization = 'vertical' | 'horizontal' | 'circular'

export type ModulationId = 'BPSK' | 'QPSK' | '16QAM' | '64QAM'

export type ModelId = 'p2001' | 'fspl-p526'

export type BackendId = 'http' | 'wasm'

/** Точка в геодезических координатах (WGS 84, градусы). */
export interface LatLon {
  lat: number
  lon: number
}

/** Координаты в СК-42: зона, проекция Гаусса–Крюгера (м). */
export interface Sk42 {
  zone: number
  x: number // север (м)
  y: number // восток с ведущей цифрой зоны (м)
}

/** Антенна: упрощённый и подробный режим (ТЗ 4.4). */
export interface AntennaParams {
  gainDbi: number
  /** Подробный режим */
  beamwidthDeg?: number
  sidelobeDb?: number
  polarization: Polarization
  mismatchLossDb?: number
  vswr?: number
  feederLossDb?: number
  azimuthDeg?: number
  elevationDeg?: number
}

export interface TransceiverParams {
  /** Мощность передатчика, дБм */
  powerDbm: number
  /** Чувствительность, дБм */
  sensitivityDbm: number
  /** Подробный режим */
  noiseBandwidthHz?: number
  noiseFigureDb?: number
  modulation?: ModulationId
  requiredEbN0Db?: number
}

/** Атмосферные и дополнительные потери (ТЗ 4.7). */
export interface AtmosphereParams {
  /** Интенсивность дождя 0.01%, мм/ч (P.837) */
  rainRateMmH?: number
  /** Учёт атмосферных газов (P.676) */
  gases: boolean
  /** Учёт растительности (P.833) — требует данных clutter */
  vegetation: boolean
  /** Высота водяного пара, кг/м^2 (по умолчанию P.836) */
  waterVaporKgM2?: number
  /** Температура поверхности, K (P.1510) */
  temperatureK?: number
  /** Давление, гПа */
  pressureHPa?: number
}

export interface EquipmentParams {
  mode: 'simple' | 'detailed'
  tx: AntennaParams
  rx: AntennaParams
  transmitter: TransceiverParams
  receiver: TransceiverParams
}

/** Точка профиля трассы. */
export interface ProfilePoint {
  /** Расстояние от точки A, м */
  d: number
  /** Высота рельефа, м */
  elev: number
  /** Высота препятствия (здания/растительности) поверх рельефа, м */
  clutter: number
  /** Полная высота: elev + clutter */
  total: number
}

export interface PathGeometry {
  points: LatLon[]
  distanceM: number
  azimuthDeg: number
  profile: ProfilePoint[]
  /** Разрешение DEM (м) */
  demStepM: number
  demSource: string
}

/** Вход расчёта модели распространения. */
export interface CalculationInput {
  frequencyMhz: number
  polarization: Polarization
  path: PathGeometry
  /** Высота подвеса антенн над землёй, м */
  txHeightM: number
  rxHeightM: number
  /** Процент времени для P.2001: 50 / 90 / 99 */
  timePercents: number[]
  /** Рефракция: фактор к (по умолчанию 4/3) */
  kFactor: number
  atmosphere: AtmosphereParams
  /** epsilon и sigma поверхности (P.527) */
  epsilon: number
  sigma: number
  /** Климатическая зона (P.838/P.453) */
  climateZone: string
  /** Авиационный режим: rx — воздушное судно */
  aviation?: boolean
}

export interface MechanismBreakdown {
  freeSpaceDb: number
  diffractionDb: number
  troposcatterDb?: number
  multipathDb?: number
  rainDb?: number
  gasesDb?: number
  vegetationDb?: number
  clutterDb?: number
}

export interface TimePercentLoss {
  percent: number
  lossDb: number
}

export interface PropagationResult {
  model: ModelId
  /** Медианные потери, дБ */
  medianLossDb: number
  /** Потери для заданных процентов времени */
  byTimePercent: TimePercentLoss[]
  breakdown: MechanismBreakdown
  /** Фактическая модель, которая отработала (после fallback) */
  engineUsed: string
  warnings: string[]
}

/** Строка бюджета линии (ТЗ 4.4.4). */
export interface BudgetRow {
  label: string
  value: number
  unit: 'дБм' | 'дБ' | 'дБи' | 'Гц' | 'м'
  sign: '+' | '-' | '='
}

export interface LinkBudget {
  eirpDbm: number
  pathLossDb: number
  prxDbm: number
  noisePowerDbm: number
  ktbDbm: number
  nfDb: number
  snrDb: number
  ebN0ActualDb: number
  ebN0RequiredDb: number
  /** Link margin = SNR − Eb/N0_req (формула ТЗ) */
  linkMarginDb: number
  income: BudgetRow[]
  expense: BudgetRow[]
  dopplerShiftHz?: number
  dopplerLossDb?: number
}

/** Возможности модели (ТЗ 3.1: getCapabilities). */
export interface ModelCapabilities {
  model: ModelId
  supportsTimePercent: boolean
  supportsMaps: boolean
  minFrequencyMhz: number
  maxFrequencyMhz: number
  requiresBackend: boolean
  description: string
}

/** Интерфейс модели распространения (ТЗ 3.1). */
export interface PropagationModel {
  calculate(input: CalculationInput): Promise<PropagationResult>
  getCapabilities(): ModelCapabilities
}

/** Параметры летающего объекта (ТЗ 4.5.1). */
export interface DynamicParams {
  /** Высота полёта, м */
  altitudeM: number
  /** Путевая скорость, км/ч (100–200) */
  speedKmh: number
  /** Начальные угол места и азимут, град */
  initialElevationDeg: number
  initialAzimuthDeg: number
  /** Азимут траектории, град */
  trajectoryAzimuthDeg: number
  /** Длительность моделирования, с */
  durationS: number
}

export interface DynamicSample {
  t: number
  /** Угол места от точки A, град */
  elevationDeg: number
  azimuthDeg: number
  /** Наклонная дальность, м */
  slantM: number
  radialVelocityMs: number
  dopplerHz: number
  pathLossDb: number
  snrDb: number
  linkMarginDb: number
  dopplerLossDb: number
  inZone: boolean
}

export interface DynamicsResult {
  samples: DynamicSample[]
  maxDopplerHz: number
  minMarginDb: number
  exitTimeS: number | null
  warnings: string[]
}

/** История расчётов (ТЗ 4.9). */
export interface HistoryEntry {
  id?: number
  deviceId: string
  createdAt: string // ISO
  name: string
  model: ModelId
  engineUsed: string
  backend: BackendId
  frequencyMhz: number
  distanceKm: number
  medianLossDb: number
  linkMarginDb: number
  input: CalculationInput
  budget: LinkBudget
  synced: boolean
}
