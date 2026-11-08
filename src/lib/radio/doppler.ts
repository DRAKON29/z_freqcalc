/**
 * Динамические (летающие) объекты:
 *  • прямолинейная траектория с постоянной скоростью или маршрут из файла;
 *  • потери по профилю рельефа для каждого сэмпла (FSPL + P.526 дифракция
 *    + clutter + газы — та же медианная цепочка, что в статике; роадмап 2.2);
 *  • наведение антенн по текущему углу места: ошибка = |el(t) − initialElevationDeg|;
 *  • доплеровский сдвиг Δf = (v_r / c) · f с обязательным учётом в бюджете;
 *  • предупреждение при выходе из зоны связи и вне тайлов рельефа.
 */
import { C_LIGHT, KTB_DBM_HZ, LIMITS, MODULATIONS } from './constants'
import { destination, bearingDeg, distanceM } from './coordinates'
import { routeStateAt, routeDurationS } from './route'
import { fsplDb } from './fspl'
import { gasesLossDb } from './atmosphere'
import { buildProfile, pointInTiles, type DemSource, type HgtTile } from './terrain'
import { medianMechanismsLossDb } from './p2001lite'
import { pointingLossDb } from './budget'
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

/** Угол места на объект с антенны Tx, град (геометрия, без рельефа). */
function elevationAngleDeg(hTx: number, hAirM: number, dGroundM: number): number {
  const dTotal = Math.hypot(dGroundM, hAirM - hTx)
  if (dTotal === 0) return 90
  return Math.atan2(hAirM - hTx, dGroundM) * (180 / Math.PI)
}

/** Параметры расчёта динамики (роадмап 2.2: рельеф per-sample + ДН по углу места). */
export interface DynamicsOpts {
  powerDbm: number
  txGainDbi: number
  rxGainDbi: number
  sensitivityDbm: number
  noiseBandwidthHz: number
  noiseFigureDb: number
  modulation: keyof typeof MODULATIONS
  /** Ширины луча и УБЛ антенн: потери наведения = f(|el(t) − initialElevationDeg|) */
  txBeamwidthDeg?: number
  txSidelobeDb?: number
  rxBeamwidthDeg?: number
  rxSidelobeDb?: number
  /** Рельеф и clutter для построения профиля Tx→позиция на каждом сэмпле */
  dem: DemSource
  clutterAt?: (lat: number, lon: number) => { type: string; height: number } | null
  /** Тайлы рельефа — для предупреждения о непокрытой траектории */
  hgtTiles?: HgtTile[]
  onProgress?: (done: number, total: number) => void
}

/**
 * Расчёт динамики: объект стартует в точке A (над Tx) и движется по азимуту
 * траектории с постоянной скоростью на постоянной высоте. При заданном route
 * движение — по ломаной из файла траектории: позиция, высота и скорость
 * меняются по участкам (см. route.ts).
 *
 * Потери для каждого сэмпла — медианная цепочка статической модели по профилю
 * рельефа Tx→позиция (FSPL + P.526 + clutter + газы); растительность не
 * применяется (борт выше препятствий — сигнал проходит над лесом). Функция
 * асинхронная: уступает поток UI для прогресса.
 */
export async function simulateDynamics(
  input: CalculationInput,
  params: DynamicParams,
  opts: DynamicsOpts,
  route?: RouteData | null,
): Promise<DynamicsResult> {
  const freqMhz = input.frequencyMhz
  const speedMs = params.speedKmh / 3.6
  const warnings: string[] = []

  if (route) {
    const speeds = route.points.map((p) => p.speedKmh)
    const vMin = Math.min(...speeds)
    const vMax = Math.max(...speeds)
    if (vMin < LIMITS.speedMinKmh || vMax > LIMITS.speedMaxKmh) {
      warnings.push(`Путевые скорости точек маршрута ${vMin}–${vMax} км/ч вне диапазона ${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh} км/ч`)
    }
  } else if (params.speedKmh < LIMITS.speedMinKmh || params.speedKmh > LIMITS.speedMaxKmh) {
    warnings.push(`Путевая скорость ${params.speedKmh} км/ч вне диапазона ${LIMITS.speedMinKmh}–${LIMITS.speedMaxKmh} км/ч`)
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
  let outsideTiles = 0
  let tileChecks = 0

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

    // Потери по профилю рельефа Tx→текущая позиция (роадмап 2.2): FSPL + P.526
    // дифракция + clutter + газы — та же медианная цепочка, что в статике.
    // Растительность исключена: борт выше препятствий, сигнал проходит над лесом.
    const profile = buildProfile(tx, pos, opts.dem, opts.clutterAt)
    const sampleInput: CalculationInput = {
      ...input,
      rxHeightM: Math.max(1, altM - (profile[profile.length - 1]?.elev ?? 0)),
      atmosphere: { ...input.atmosphere, vegetation: false },
      path: {
        points: [tx, pos],
        // FSPL и газы — по наклонной дальности (истинная длина воздушного пути),
        // профиль дифракции — по земле (расстояния профиля — ground distance)
        distanceM: slantM,
        azimuthDeg: bearingDeg(tx, pos),
        profile,
        demStepM: input.path.demStepM,
        demSource: input.path.demSource,
      },
    }
    // На вырожденных дистанциях (старт строго над станцией) профиль не строится —
    // чистый FSPL по наклонной дальности
    const lossDb =
      dGround > 10
        ? medianMechanismsLossDb(sampleInput).lossDb
        : fsplDb(slantM, freqMhz) + (input.atmosphere.gases ? gasesLossDb(slantM, freqMhz, 90) : 0)

    // Наведение антенн по текущему углу места: номинал — initialElevationDeg
    // (угол на объект в начале полёта); omni (≥180°) — наведения нет
    const pointErrDeg = Math.abs(elevDeg - params.initialElevationDeg)
    const txPointing = pointingLossDb(opts.txBeamwidthDeg, opts.txSidelobeDb, pointErrDeg)
    const rxPointing = pointingLossDb(opts.rxBeamwidthDeg, opts.rxSidelobeDb, pointErrDeg)

    const eirp = opts.powerDbm + opts.txGainDbi
    const prx = eirp - txPointing - lossDb + opts.rxGainDbi - rxPointing
    const noise = KTB_DBM_HZ + 10 * Math.log10(opts.noiseBandwidthHz) + opts.noiseFigureDb
    const snrDb = prx - noise
    const dopLoss = dopplerLossDb(dopplerHz, opts.noiseBandwidthHz, opts.modulation)
    const marginDb = snrDb - dopLoss - MODULATIONS[opts.modulation].ebN0Db

    const inZone = prx >= opts.sensitivityDbm && marginDb > 0

    // Покрытие траектории тайлами рельефа
    if (opts.hgtTiles && opts.hgtTiles.length > 0) {
      tileChecks++
      if (!pointInTiles(pos.lat, pos.lon, opts.hgtTiles)) outsideTiles++
    }

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

    // Уступаем поток UI для прогресса (расчёт тяжёлый: профиль + дифракция на сэмпл)
    if (i % 20 === 19) {
      opts.onProgress?.(i + 1, nSteps + 1)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  opts.onProgress?.(nSteps + 1, nSteps + 1)

  if (tileChecks > 0 && outsideTiles / tileChecks > 0.01) {
    const pct = Math.round((outsideTiles / tileChecks) * 100)
    warnings.push(`Часть траектории (${pct}% сэмплов) вне загруженных тайлов рельефа — там высота принята 0 м`)
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
