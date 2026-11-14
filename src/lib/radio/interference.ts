/**
 * Интерференция C/I (роадмап 2.3): путь помехи по ITU-R P.452-18
 * (вендоренный порт Py452 в python-сервисе, /api/interference) + вердикт
 * по защитным отношениям на клиенте.
 *
 * Потери пути помехи считает python (P.452 недоступен без карт ITU N050/DN50 —
 * тогда TS-фоллбек: медиана P.2001-lite с честным предупреждением). Вердикт
 * (I, I/N, C/I vs C/I_min, деградация шума) — чистая функция на клиенте:
 * она одинаково работает для любого движка, как availability-отчёт.
 *
 * Допущения (задокументированы в UI): помеха ко-канальная (полное
 * спектральное перекрытие), интерференция складывается с шумом как шум.
 */
import { apiUrl } from './models/api'
import { computeP2001Lite } from './p2001lite'
import { bearingDeg, distanceM } from './coordinates'
import { pointingLossDb } from './budget'
import type {
  CalculationInput,
  EquipmentParams,
  InterferenceImpact,
  InterferenceLevel,
  InterferenceReport,
  LatLon,
  Polarization,
} from './types'

/** Один путь помехи для /api/interference (профиль уже построен клиентом). */
export interface InterferencePathPayload {
  id: string
  source: LatLon
  victim: LatLon
  txHeightM: number
  rxHeightM: number
  /** d (м, возрастает), h (м над у.м.), g (м над у.м., рельеф+clutter) */
  profile: { d: number[]; h: number[]; g: number[] }
}

export interface InterferenceLossRequest {
  paths: InterferencePathPayload[]
  frequencyMhz: number
  polarization: Polarization
  /** Проценты времени P.452 (0.001–50): по умолчанию [50, 1] */
  p?: number[]
  /** Радиоклиматическая зона: 1 прибрежная суша / 2 суша / 3 море */
  zone?: number
  pressHPa?: number
  tempC?: number
}

export interface InterferenceLossResult {
  results: Record<string, Record<string, number>>
  engineUsed: string
  warnings: string[]
}

/** Потери одного пути помехи по всем запрошенным процентам времени. */
export interface InterferencePathLosses {
  /** Потери для p = 50 % (медиана), дБ */
  p50: number
  /** Потери для p = 1 % (null — не считалась, например фоллбек) */
  p1: number | null
  engineUsed: string
  warnings: string[]
}

/** Прямой вызов /api/interference. Бросает исключение при ошибке сервиса. */
export async function fetchInterferenceLoss(req: InterferenceLossRequest): Promise<InterferenceLossResult> {
  const res = await fetch(apiUrl('/interference'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return (await res.json()) as InterferenceLossResult
}

/**
 * Потери путей помехи: P.452 через python-сервис; при недоступности —
 * TS-фоллбек (медиана P.2001-lite на том же профиле) с честным предупреждением.
 *
 * @param fallbackInputs входы P.2001-lite для каждого path.id (клиент строит
 *   профиль тем же buildProfile, что и для полезной линии)
 */
export async function computeInterferencePathLosses(args: {
  paths: InterferencePathPayload[]
  frequencyMhz: number
  polarization: Polarization
  zone: number
  fallbackInputs: Record<string, CalculationInput>
}): Promise<Record<string, InterferencePathLosses>> {
  const p = [50, 1]
  try {
    const res = await fetchInterferenceLoss({
      paths: args.paths,
      frequencyMhz: args.frequencyMhz,
      polarization: args.polarization,
      p,
      zone: args.zone,
    })
    const out: Record<string, InterferencePathLosses> = {}
    for (const path of args.paths) {
      const entry = res.results[path.id] ?? {}
      out[path.id] = {
        p50: entry['50'] ?? entry['50.0'],
        p1: entry['1'] ?? entry['1.0'] ?? null,
        engineUsed: res.engineUsed,
        warnings: res.warnings,
      }
    }
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const warning = `P.452 недоступен (${msg}) — путь помехи оценён медианой P.2001-lite (50 % времени; коротковременная помеха p = 1 % не рассчитывается)`
    const out: Record<string, InterferencePathLosses> = {}
    for (const path of args.paths) {
      const input = args.fallbackInputs[path.id]
      const prop = input ? computeP2001Lite(input) : null
      out[path.id] = {
        p50: prop?.medianLossDb ?? NaN,
        p1: null,
        engineUsed: 'TS: P.2001-lite (фоллбек от P.452 — нужен python-сервис с картами N050/DN50)',
        warnings: [warning],
      }
    }
    return out
  }
}

/** Класс влияния помехи по деградации шума Δ. */
export function interferenceImpact(degradationDb: number): InterferenceImpact {
  if (degradationDb < 0.5) return 'none'
  if (degradationDb < 1) return 'minor'
  if (degradationDb < 3) return 'notable'
  return 'severe'
}

export const INTERFERENCE_IMPACT_LABELS: Record<InterferenceImpact, string> = {
  none: 'Помеха не влияет',
  minor: 'Незначительное влияние',
  notable: 'Заметное влияние',
  severe: 'Сильное влияние',
}

/** Угол между главным лепестком антенны жертвы и направлением на помеху, град. */
export function discriminationAngleDeg(victimTxPoint: LatLon, victimPoint: LatLon, source: LatLon): number {
  const main = bearingDeg(victimPoint, victimTxPoint)
  const toInterferer = bearingDeg(victimPoint, source)
  const diff = Math.abs(main - toInterferer) % 360
  return diff > 180 ? 360 - diff : diff
}

/** Уровень помехи I для заданных потерь пути и антенны жертвы, дБм. */
export function interferenceLevel(
  p: number,
  pathLossDb: number,
  interferenceEirpDbm: number,
  victimGainDbi: number,
  victimBeamwidthDeg: number | undefined,
  victimSidelobeDb: number | undefined,
  discriminationDeg: number,
  noisePowerDbm: number,
): InterferenceLevel {
  const pointing = pointingLossDb(victimBeamwidthDeg, victimSidelobeDb, discriminationDeg)
  // I = EIRP(помехи) − L(путь помехи) + G(жертвы) − A(разнос антенн)
  const iDbm = interferenceEirpDbm - pathLossDb + victimGainDbi - pointing
  const inDb = iDbm - noisePowerDbm
  const degradationDb = 10 * Math.log10(1 + Math.pow(10, inDb / 10))
  return { p, pathLossDb, iDbm, inDb, degradationDb, ciDb: NaN } // ciDb заполнит buildInterferenceReport
}

export interface BuildInterferenceReportArgs {
  source: LatLon
  victimPoint: LatLon
  victimTxPoint: LatLon
  /** Позиция Tx полезной линии для расчёта угла разноса (см. victimTxPoint) */
  frequencyMhz: number
  /** Полезный сигнал в приёмнике жертвы (P_rx), дБм */
  carrierDbm: number
  /** Шум приёмника жертвы N (kTB + NF + Fa), дБм */
  noisePowerDbm: number
  /** Запас полезной линии без помехи, дБ */
  linkMarginDb: number
  /** Eb/N0, требуемое приёмнику жертвы — дефолт C/I_min */
  requiredEbN0Db: number
  /** Пользовательское защитное отношение (null — использовать дефолт) */
  ciMinDb: number | null
  /** EIRP источника помехи, дБм */
  interferenceEirpDbm: number
  /** Антенна жертвы (усиление/ширина луча/УБЛ) */
  victimAntenna: EquipmentParams['rx']
  losses: InterferencePathLosses
}

/**
 * Сборка отчёта интерференции (чистая функция): уровни I для p = 50/1 %,
 * вердикт по защитному отношению C/I ≥ C/I_min и деградация шума.
 */
export function buildInterferenceReport(args: BuildInterferenceReportArgs): InterferenceReport {
  const disc = discriminationAngleDeg(args.victimTxPoint, args.victimPoint, args.source)
  const levelOf = (p: number, pathLossDb: number): InterferenceLevel => {
    const lvl = interferenceLevel(
      p, pathLossDb, args.interferenceEirpDbm, args.victimAntenna.gainDbi,
      args.victimAntenna.beamwidthDeg, args.victimAntenna.sidelobeDb, disc, args.noisePowerDbm,
    )
    lvl.ciDb = args.carrierDbm - lvl.iDbm
    return lvl
  }

  const median = levelOf(50, args.losses.p50)
  const shortTerm = args.losses.p1 !== null ? levelOf(1, args.losses.p1) : null

  const ciMinDb = args.ciMinDb ?? args.requiredEbN0Db
  const ciMet = median.ciDb >= ciMinDb
  const impact = interferenceImpact(median.degradationDb)
  // C/(N+I) = SNR − Δ; запас с помехой = linkMargin − Δ
  const snrWithIDb = args.carrierDbm - (args.noisePowerDbm + median.degradationDb)
  const marginWithIDb = args.linkMarginDb - median.degradationDb

  return {
    source: args.source,
    victimPoint: args.victimPoint,
    victimTxPoint: args.victimTxPoint,
    pathKm: distanceM(args.source, args.victimPoint) / 1000,
    frequencyMhz: args.frequencyMhz,
    eirpDbm: args.interferenceEirpDbm,
    engineUsed: args.losses.engineUsed,
    warnings: args.losses.warnings,
    ciMinDb,
    ciMinSource: args.ciMinDb === null ? 'default-ebn0' : 'user',
    median,
    shortTerm,
    ciMet,
    impact,
    snrWithIDb,
    marginWithIDb,
  }
}
