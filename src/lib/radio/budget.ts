/**
 * Бюджет линии — формулы
 *   EIRP = P_tx − L_feeder_tx − L_point_tx + G_tx
 *   P_rx = EIRP − L_path + G_rx − L_feeder_rx − L_point_rx
 *   N = kTB + NF
 *   SNR = P_rx − N
 *   Link margin = SNR − Eb/N0_req
 */
import { KTB_DBM_HZ, MODULATIONS } from './constants'
import type { BudgetRow, CalculationInput, EquipmentParams, LinkBudget, PropagationResult } from './types'

export interface BudgetExtraLosses {
  dopplerLossDb?: number
  modulationDegradationDb?: number
}

/** Номинальное отклонение оси антенны от направления на корреспондента, °
 *  (подвижный объект и антенны без идеального автосопровождения). */
export const NOMINAL_POINTING_ERROR_DEG = 10

/**
 * Потери на неточное наведение антенны — параболическая модель главного лепестка:
 * A(θ) = 12·(θ/θ3дБ)² дБ, ограничены уровнем боковых лепестков (за пределами
 * главного лепестка усиление не падает ниже УБЛ). При ширине луча ≥ 180°
 * (всенаправленная антенна) потери не учитываются.
 */
export function pointingLossDb(beamwidthDeg?: number, sidelobeDb?: number): number {
  const bw = beamwidthDeg ?? 30
  if (!(bw > 0) || bw >= 180) return 0
  const loss = 12 * (NOMINAL_POINTING_ERROR_DEG / bw) ** 2
  return Math.min(loss, -(sidelobeDb ?? -25))
}

/** Запас ниже этого порога (дБ) считается отсутствием связи. */
export const LINK_LOST_MARGIN_DB = -10

export type LinkStatus = 'stable' | 'marginal' | 'lost'

/**
 * Цветовой статус связи по запасу на линию:
 *  • stable  — связь стабильна (запас ≥ 0 дБ; при кривой замираний P.2001 —
 *              запас покрывает рост потерь вплоть до наибольшего процента
 *              времени, т.е. доступность ≥ 99 %);
 *  • marginal — связь нестабильна (медиана на грани или замирания срывают:
 *              доступность от эпизодической до ~99 %, запас не ниже −10 дБ);
 *  • lost    — связь отсутствует (запас ниже −10 дБ).
 */
export function linkStatus(marginDb: number, prop?: Pick<PropagationResult, 'byTimePercent'>): LinkStatus {
  const pts = prop?.byTimePercent ?? []
  const l50 = pts.find((t) => t.percent === 50)?.lossDb
  const high = pts.reduce<{ percent: number; lossDb: number } | null>(
    (acc, t) => (!acc || t.percent > acc.percent ? t : acc),
    null,
  )
  if (l50 !== undefined && high && high.percent > 50 && high.lossDb < l50) {
    // Доступность ≥ 99 %: требуемый порог потерь не превышается и на верхнем проценте времени
    if (marginDb >= l50 - high.lossDb) return 'stable'
  } else if (marginDb >= 0) {
    return 'stable'
  }
  return marginDb >= LINK_LOST_MARGIN_DB ? 'marginal' : 'lost'
}

export function computeLinkBudget(
  input: CalculationInput,
  equipment: EquipmentParams,
  prop: PropagationResult,
  extra: BudgetExtraLosses = {},
): LinkBudget {
  const detailed = equipment.mode === 'detailed'

  const txFeeder = detailed ? equipment.tx.feederLossDb ?? 0 : 0
  const rxFeeder = detailed ? equipment.rx.feederLossDb ?? 0 : 0
  const txMismatch = detailed ? equipment.tx.mismatchLossDb ?? 0 : 0
  const rxMismatch = detailed ? equipment.rx.mismatchLossDb ?? 0 : 0
  // Потери на наведение — по ширине луча, в обоих режимах (simple и detailed)
  const txPointing = pointingLossDb(equipment.tx.beamwidthDeg, equipment.tx.sidelobeDb)
  const rxPointing = pointingLossDb(equipment.rx.beamwidthDeg, equipment.rx.sidelobeDb)

  // EIRP = P_tx − L_feeder_tx − L_point_tx + G_tx
  const eirpDbm = equipment.transmitter.powerDbm - txFeeder - txMismatch - txPointing + equipment.tx.gainDbi

  // Суммарные потери на трассе
  const extraLoss =
    (prop.breakdown.rainDb ?? 0) +
    (prop.breakdown.gasesDb ?? 0) +
    (prop.breakdown.vegetationDb ?? 0) +
    (extra.dopplerLossDb ?? 0) +
    (extra.modulationDegradationDb ?? 0)

  // P_rx = EIRP − L_path + G_rx − L_feeder_rx − L_point_rx
  const prxDbm = eirpDbm - prop.medianLossDb - extraLoss + equipment.rx.gainDbi - rxFeeder - rxMismatch - rxPointing

  // N = kTB + NF
  const nfDb = detailed ? equipment.receiver.noiseFigureDb ?? 3 : 3
  const bHz = detailed ? equipment.receiver.noiseBandwidthHz ?? 1e6 : 1e6
  const ktbDbm = KTB_DBM_HZ + 10 * Math.log10(bHz)
  const noisePowerDbm = ktbDbm + nfDb

  // SNR = P_rx − N
  const snrDb = prxDbm - noisePowerDbm

  // Eb/N0: факт = SNR + 10lg(B/Rb) — при заданной полосе и модуляции
  const mod = equipment.receiver.modulation ?? 'QPSK'
  const ebN0Req = equipment.receiver.requiredEbN0Db ?? MODULATIONS[mod].ebN0Db
  const bitsPerSymbol = MODULATIONS[mod].bitsPerSymbol
  const rbHz = bHz * bitsPerSymbol // упрощение: Rb = B · log2(M) при Nyquist-полосе
  const ebN0ActualDb = snrDb + 10 * Math.log10(bHz / rbHz)

 // Link margin = SNR − Eb/N0_req
  const linkMarginDb = snrDb - ebN0Req

  const income: BudgetRow[] = [
    { label: 'Мощность передатчика (P_tx)', value: equipment.transmitter.powerDbm, unit: 'дБм', sign: '+' },
    ...(txFeeder ? [{ label: 'Потери фидера Tx', value: -txFeeder, unit: 'дБ' as const, sign: '+' as const }] : []),
    ...(txMismatch ? [{ label: 'Рассогласование Tx', value: -txMismatch, unit: 'дБ' as const, sign: '+' as const }] : []),
    { label: 'Усиление антенны Tx (G_tx)', value: equipment.tx.gainDbi, unit: 'дБи', sign: '+' },
    ...(txPointing ? [{ label: 'Наведение антенны Tx (ширина луча)', value: -txPointing, unit: 'дБ' as const, sign: '+' as const }] : []),
    { label: 'ЭИИМ (EIRP)', value: eirpDbm, unit: 'дБм', sign: '=' },
    { label: 'Потери на трассе (L_path)', value: -prop.medianLossDb, unit: 'дБ', sign: '+' },
    ...(extra.dopplerLossDb ? [{ label: 'Деградация от доплера', value: -extra.dopplerLossDb, unit: 'дБ' as const, sign: '+' as const }] : []),
    { label: 'Усиление антенны Rx (G_rx)', value: equipment.rx.gainDbi, unit: 'дБи', sign: '+' },
    ...(rxFeeder ? [{ label: 'Потери фидера Rx', value: -rxFeeder, unit: 'дБ' as const, sign: '+' as const }] : []),
    ...(rxMismatch ? [{ label: 'Рассогласование Rx', value: -rxMismatch, unit: 'дБ' as const, sign: '+' as const }] : []),
    ...(rxPointing ? [{ label: 'Наведение антенны Rx (ширина луча)', value: -rxPointing, unit: 'дБ' as const, sign: '+' as const }] : []),
  ]

  const expense: BudgetRow[] = [
    { label: 'Мощность сигнала (P_rx)', value: prxDbm, unit: 'дБм', sign: '=' },
    { label: 'kTB (B = ' + fmtHz(bHz) + ')', value: ktbDbm, unit: 'дБм', sign: '+' },
    { label: 'Коэффициент шума (NF)', value: nfDb, unit: 'дБ', sign: '+' },
    { label: 'Мощность шума (N)', value: noisePowerDbm, unit: 'дБм', sign: '=' },
    { label: 'SNR', value: snrDb, unit: 'дБ', sign: '=' },
    { label: 'Требуемое Eb/N0 (' + mod + ')', value: -ebN0Req, unit: 'дБ', sign: '+' },
    { label: 'Link margin', value: linkMarginDb, unit: 'дБ', sign: '=' },
  ]

  return {
    eirpDbm,
    pathLossDb: prop.medianLossDb,
    prxDbm,
    noisePowerDbm,
    ktbDbm,
    nfDb,
    snrDb,
    ebN0ActualDb,
    ebN0RequiredDb: ebN0Req,
    linkMarginDb,
    income,
    expense,
  }
}

function fmtHz(hz: number): string {
  if (hz >= 1e9) return (hz / 1e9).toFixed(1) + ' ГГц'
  if (hz >= 1e6) return (hz / 1e6).toFixed(1) + ' МГц'
  if (hz >= 1e3) return (hz / 1e3).toFixed(1) + ' кГц'
  return hz.toFixed(0) + ' Гц'
}

/** Проверка чувствительности: P_rx ≥ чувствительность приёмника. */
export function sensitivityOk(budget: LinkBudget, equipment: EquipmentParams): boolean {
  return budget.prxDbm >= equipment.receiver.sensitivityDbm
}
