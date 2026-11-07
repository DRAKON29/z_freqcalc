/**
 * Общие типы калькулятора распространения радиоволн.
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

/** Антенна: упрощённый и подробный режим. */
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

/** Атмосферные и дополнительные потери. */
export interface AtmosphereParams {
  /** Интенсивность дождя 0.01%, мм/ч (P.837) */
  rainRateMmH?: number
  /** Источник интенсивности дождя: из карт ITU (R0.01) или вручную */
  rainSource?: 'itu' | 'user'
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

/**
 * Снимок условий из цифровых продуктов ITU-R P.2001-6 (Table 3),
 * извлечённых в точках трассы (среднее концов A и Б).
 * Отсутствующее значение (undefined) — продукт не загружен.
 */
export interface ItuEnvironmentData {
  /** Плотность водяного пара у поверхности, г/м³ (Surfwv_50_fixed.txt, P.836-4) */
  rho50?: number
  /** Интенсивность дождя Pr6, мм/ч (Esarain_Pr6_v5.txt, P.837-5) */
  pr6?: number
  /** Суммарная масса дождя Mt, кг·м⁻²·год⁻¹ (Esarain_Mt_v5.txt, P.837-5) */
  rainMassMt?: number
  /** Вероятность дождя β, доля года 0…1 (Esarain_Beta_v5.txt, P.837-5) */
  beta0?: number
  /** Вероятность дождя P0, % — производная P.837-6 (шаг 4) от Pr6, Mt, β */
  rainProbP0?: number
  /** Интенсивность дождя R0.01, мм/ч — производная P.837-6 (шаг 5) от Pr6, Mt, β */
  rainRate001?: number
  /** Высота дождя (изотерма 0 °C) h0, км (h0.txt, P.839-4) */
  isothermH0Km?: number
  /** Медианный градиент рефракции ΔN, N/км (DN_Median.txt, P.453) */
  dnMedian?: number
  /** Градиент, превышаемый 0.1 % времени dN1, N/км (dndz_01.txt, P.453-10) */
  dndz01?: number
  /** Наклон подрефрактивной ветви CDF, N/км (DN_SubSlope.txt, P.453) */
  dnSubSlope?: number
  /** Наклон сверхрефрактивной ветви CDF, N/км (DN_SupSlope.txt, P.453) */
  dnSupSlope?: number
  /** Климатическая зона тропосферного рассеяния 1–14 (TropoClim.txt, Annex E) */
  tropoZone?: number
  /** foEs, превышаемый 0.1 % времени, МГц (FoEs0.1.txt, Annex G) */
  foEs001?: number
  /** foEs, превышаемый 1 % времени, МГц (FoEs01.txt, Annex G) */
  foEs01?: number
  /** foEs, превышаемый 10 % времени, МГц (FoEs10.txt, Annex G) */
  foEs10?: number
  /** foEs, превышаемый 50 % времени, МГц (FoEs50.txt, Annex G) */
  foEs50?: number
  /** Медианный k-фактор из DN_Median: k = 157/(157 + ΔN) (P.453) */
  k50?: number
  /** k-фактор для 0.1 % времени из dndz_01 (P.453) */
  k01?: number
  /** Файлы продуктов, значения которых вошли в снимок */
  usedProducts: string[]
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
  /** Источник k-фактора: из карты DN_Median (P.453) или вручную */
  kFactorSource?: 'itu' | 'user'
  atmosphere: AtmosphereParams
  /** Условия из цифровых продуктов ITU-R P.2001-6 (заполняется при загруженных картах) */
  environment?: ItuEnvironmentData
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

/** Строка бюджета линии. */
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
  /** Link margin = SNR − Eb/N0_req */
  linkMarginDb: number
  income: BudgetRow[]
  expense: BudgetRow[]
  dopplerShiftHz?: number
  dopplerLossDb?: number
}

/** Возможности модели (getCapabilities). */
export interface ModelCapabilities {
  model: ModelId
  supportsTimePercent: boolean
  supportsMaps: boolean
  minFrequencyMhz: number
  maxFrequencyMhz: number
  requiresBackend: boolean
  description: string
}

/** Интерфейс модели распространения. */
export interface PropagationModel {
  calculate(input: CalculationInput): Promise<PropagationResult>
  getCapabilities(): ModelCapabilities
}

/** Параметры летающего объекта. */
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

/** Точка траектории из файла маршрута. */
export interface RouteWaypoint {
  lat: number
  lon: number
  /** Высота полёта, м (абсолютная) */
  altitudeM: number
  /** Путевая скорость на участке от этой точки до следующей, км/ч */
  speedKmh: number
}

/** Маршрут из файла траектории (первая и последняя точки — концы траектории). */
export interface RouteData {
  /** Имя файла-источника (для отображения) */
  name?: string
  points: RouteWaypoint[]
  /** Высота антенны на штативе наземной станции, м */
  tripodHeightM: number
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
  /** Текущая высота полёта, м (маршрут из файла — переменная) */
  altitudeM?: number
  /** Текущая путевая скорость, км/ч (маршрут из файла — переменная) */
  speedKmh?: number
}

export interface DynamicsResult {
  samples: DynamicSample[]
  maxDopplerHz: number
  minMarginDb: number
  exitTimeS: number | null
  warnings: string[]
  /** Высота полёта, для которой выполнен расчёт (многовысотный режим) */
  altitudeM?: number
  /** Подпись серии для легенд графиков (маршрут из файла) */
  label?: string
}

/** Результат расчёта на одной частоте (режим «диапазон частот»). */
export interface RangeFreqResult {
  frequencyMhz: number
  medianLossDb: number
  linkMarginDb: number
  prxDbm: number
  snrDb: number
}

/** История расчётов. */
export interface HistoryLinkParams {
  /**
   * Снимок параметров линка на момент расчёта — для полного восстановления
   * формы из истории (частотные режимы обеих станций и оборудование).
   */
  frequencyMode: 'single' | 'range'
  freqFromMhz: number
  freqToMhz: number
  mobileFrequencyMhz: number
  mobileFrequencyMode: 'single' | 'range'
  mobileFreqFromMhz: number
  mobileFreqToMhz: number
  equipment: EquipmentParams
}

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
  /** Снимок параметров линка для восстановления формы (в старых записях отсутствует). */
  linkParams?: HistoryLinkParams
  synced: boolean
}
