/**
 * Динамические (летающие) объекты:
 *  • прямолинейная траектория с постоянной скоростью;
 *  • изменение углов места/азимута во времени;
 *  • доплеровский сдвиг Δf = (v_r / c) · f;
 *  • обязательный учёт доплера в бюджете линии;
 *  • предупреждение при выходе из зоны связи.
 */
import { C_LIGHT, MODULATIONS } from './constants'
import { destination, bearingDeg, distanceM } from './coordinates'
import { fsplDb } from './fspl'
import { routeStateAt, routeDurationS } from './route'
import type { CalculationInput, DynamicParams, DynamicSample, DynamicsResult, RouteData } from './types'

/** Допустимый доплеровский сдвиг для модуляции (доля от символьной скорости).
 *  Символьная скорость ≈ шумовая полоса (Nyquist). За пределом — деградация демодуляции. */
export function dopplerToleranceHz(bandwidthHz: number, modulation: keyof typeof MODULATIONS): number {
  const bits = MODULATIONS[modulation].bitsPerSymbol
  // Фазовая когерентность хуже для многопозиционных модуляций
  const factor = modulation === 'BPSK' || modulation === 'QPSK' ? 0.05 : 0.02 / (bits / 4)
  return bandwidthHz * factor
}

/**
 * Деградация из-за доплера (эмпирическая модель, дБ):
 * 0 до порога когерентности, далее лог-рост вплоть до срыва демодуляции (возврат 99 дБ).
 */
export function dopplerLossDb(dopplerHz: number, bandwidthHz: number, modulation: keyof typeof MODULATIONS): number {
  const tol = dopplerToleranceHz(bandwidthHz, modulation)
  const abs = Math.abs(dopplerHz)
  if (abs <= tol) return 0
  if (abs > 4 * tol) return 99 // срыв демодуляции
  // 0.5 дБ за каждую половину порога сверх tolerance
  return Math.min(30, 0.5 * Math.ceil((abs - tol) / (tol / 2) * 2) / 2)
}

/** Медианная высота рельефа под объектом (для зоны связи) — упрощённо 0. */
function elevationAngleDeg(hTx: number, hAirM: number, dGroundM: number): number {
  const dTotal = Math.hypot(dGroundM, hAirM - hTx)
  if (dTotal === 0) return 90
  return Math.atan2(hAirM - hTx, dGroundM) * (180 / Math.PI)
}

/**
 * Расчёт динамики: объект стартует в точке A (над Tx) и движется по азимуту
 * траектории с постоянной скоростью на постоянной высоте. При заданном route
 * движение — по ломаной из файла траектории: позиция, высота и скорость
 * меняются по участкам (смотр. route.ts).
 */
export function simulateDynamics(
  input: CalculationInput,
  params: DynamicParams,
  opts: {
    powerDbm: number
    txGainDbi: number
    rxGainDbi: number
    sensitivityDbm: number
    noiseBandwidthHz: number
    noiseFigureDb: number
    modulation: keyof typeof MODULATIONS
  },
  route?: RouteData | null,
): DynamicsResult {
  const freqMhz = input.frequencyMhz
  const speedMs = params.speedKmh / 3.6
  const warnings: string[] = []

  if (route) {
    const speeds = route.points.map((p) => p.speedKmh)
    const vMin = Math.min(...speeds)
    const vMax = Math.max(...speeds)
    if (vMin < 100 || vMax > 200) {
      warnings.push(`Путевые скорости точек маршрута ${vMin}–${vMax} км/ч вне диапазона 100–200 км/ч`)
    }
  } else if (params.speedKmh < 100 || params.speedKmh > 200) {
    warnings.push(`Путевая скорость ${params.speedKmh} км/ч вне диапазона 100–200 км/ч`)
  }

  const durationS = route ? routeDurationS(route) : params.durationS
  const nSteps = Math.round(Math.min(600, Math.max(60, durationS)))
  const dt = durationS / nSteps
  const tx = input.path.points[0]
  const txTotalH = (input.path.profile[0]?.elev ?? 0) + input.txHeightM

  const samples: DynamicSample[] = []
  let maxDopplerHz = 0
  let minMarginDb = Infinity
  let exitTimeS: number | null = null

  for (let i = 0; i <= nSteps; i++) {
    const t = i * dt
    let pos: { lat: number; lon: number }
    let altM: number
    let vMs: number
    let vKmh: number
    let dhDtMs: number
    let dGroundDtMs: number
    if (route) {
      const st = routeStateAt(route, t)
      pos = st.pos
      altM = st.altitudeM
      vMs = st.speedMs
      vKmh = st.speedKmh
      dhDtMs = st.dhDtMs
      // Скорость удаления от Tx: проекция вектора скорости на направление Tx→объект
      const toPosAz = bearingDeg(tx, pos)
      dGroundDtMs = vMs * Math.cos(((st.courseDeg - toPosAz) * Math.PI) / 180)
    } else {
      pos = destination(tx, speedMs * t, params.trajectoryAzimuthDeg)
      altM = params.altitudeM
      vMs = speedMs
      vKmh = params.speedKmh
      dhDtMs = 0
      dGroundDtMs = speedMs
    }
    const dGround = distanceM(tx, pos)
    const dh = altM - txTotalH

    const slantM = Math.hypot(dGround, dh)
    const elevDeg = elevationAngleDeg(txTotalH, altM, dGround)

    // Радиальная скорость — производная наклонной дальности (аналитически):
    // slant = √(d² + Δh²) → d(slant)/dt = (d·ḋ + Δh·Δḣ) / slant
    const radialMs = slantM > 0 ? (dGround * dGroundDtMs + dh * dhDtMs) / slantM : 0

    // Доплер: Δf = (v_r / c) · f
    const dopplerHz = (radialMs / C_LIGHT) * (freqMhz * 1e6)

    // Потери: FSPL по наклонной дальности (в динамике рельеф по трассе не учитываем,
    // объект в воздухе — прямой визири; точная модель дифракции выполняется в основном расчёте)
    const lossDb = fsplDb(slantM, freqMhz) + (input.atmosphere.gases ? 1.5 : 0)

    const eirp = opts.powerDbm + opts.txGainDbi
    const prx = eirp - lossDb + opts.rxGainDbi
    const noise = 10 * Math.log10(1.380649e-23 * 290 * 1e3) + 10 * Math.log10(opts.noiseBandwidthHz) + opts.noiseFigureDb
    const snrDb = prx - noise
    const dopLoss = dopplerLossDb(dopplerHz, opts.noiseBandwidthHz, opts.modulation)
    const marginDb = snrDb - dopLoss - MODULATIONS[opts.modulation].ebN0Db

    const inZone = prx >= opts.sensitivityDbm && marginDb > 0

    samples.push({
      t,
      elevationDeg: elevDeg,
      azimuthDeg: bearingDeg(tx, pos),
      slantM,
      radialVelocityMs: radialMs,
      dopplerHz,
      pathLossDb: lossDb,
      snrDb,
      linkMarginDb: marginDb,
      dopplerLossDb: dopLoss,
      inZone,
      ...(route ? { altitudeM: altM, speedKmh: vKmh } : {}),
    })

    maxDopplerHz = Math.max(maxDopplerHz, Math.abs(dopplerHz))
    minMarginDb = Math.min(minMarginDb, marginDb)
    if (!inZone && exitTimeS === null) exitTimeS = t
  }

  if (exitTimeS !== null) {
    const pathKm = route ? null : (exitTimeS * speedMs) / 1000
    warnings.push(
      pathKm !== null
        ? `Объект выходит из зоны связи через ${exitTimeS.toFixed(0)} с (путь ${pathKm.toFixed(1)} км)`
        : `Объект выходит из зоны связи через ${exitTimeS.toFixed(0)} с`,
    )
  }
  if (maxDopplerHz > dopplerToleranceHz(opts.noiseBandwidthHz, opts.modulation)) {
    warnings.push(
      `Максимальный доплер ${maxDopplerHz.toFixed(0)} Гц превышает допуск ${dopplerToleranceHz(opts.noiseBandwidthHz, opts.modulation).toFixed(0)} Гц для ${opts.modulation} — учтена деградация демодуляции`,
    )
  }

  return { samples, maxDopplerHz, minMarginDb, exitTimeS, warnings }
}

/** Траектория объекта на карте: точки маршрута из файла либо линия по азимуту. */
export function trajectoryPoints(
  tx: { lat: number; lon: number },
  params: DynamicParams,
  route?: RouteData | null,
): { lat: number; lon: number }[] {
  if (route) {
    return route.points.map((p) => ({ lat: p.lat, lon: p.lon }))
  }
  const speedMs = params.speedKmh / 3.6
  const n = 40
  const pts: { lat: number; lon: number }[] = []
  for (let i = 0; i <= n; i++) {
    const d = (speedMs * params.durationS * i) / n
    pts.push(destination(tx, d, params.trajectoryAzimuthDeg))
  }
  return pts
}

/** Расстояние до границы зоны связи (упрощённо по порогу чувствительности). */
export function zoneRadiusM(opts: { powerDbm: number; txGainDbi: number; rxGainDbi: number; sensitivityDbm: number; frequencyMhz: number; marginDb: number }): number {
  const eirp = opts.powerDbm + opts.txGainDbi
  // P_rx = EIRP − FSPL + G_rx ≥ sensitivity + margin → FSPL_max
  const fsplMax = eirp + opts.rxGainDbi - opts.sensitivityDbm - opts.marginDb
  // FSPL = 20lg(d_km) + 20lg(f) + 32.44 → d_km
  const dKm = Math.pow(10, (fsplMax - 20 * Math.log10(opts.frequencyMhz) - 32.44) / 20)
  return dKm * 1000
}
