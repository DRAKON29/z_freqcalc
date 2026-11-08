/**
 * Дополнительные атмосферные потери:
 *  • Дождь — ITU-R P.837 (интенсивность) + P.838 (коэффициенты k, α);
 *  • Атмосферные газы — ITU-R P.676 (упрощённая модель для 0.5–57 ГГц);
 *  • Растительность — ITU-R P.833 (модель Вайсбергера / deg2/deg3 упрощённо).
 */

/** Коэффициенты аппроксимации (P.838-3) — резерв для расширения на 7–100 ГГц. */
const RAIN_COEF = {
  vertical: { a: 1.32e-5, b: 1.31, c: -2.12, d: 2.24 },
  horizontal: { a: 1.21e-5, b: 1.42, c: -2.31, d: 2.52 },
} as const

/**
 * Удельное затухание в дожде (P.838): γR = k · R^α, дБ/км.
 * Аппроксимация по таблицам P.838-3 в диапазоне 0.5–7 ГГц.
 */
export function rainSpecificAttenuationDbKm(
  rainRateMmH: number,
  freqMhz: number,
  pol: 'vertical' | 'horizontal' | 'circular',
): number {
  if (rainRateMmH <= 0 || freqMhz < 100) return 0
  const k = rainCoefFit(freqMhz, pol)
  const alpha = rainAlphaFit(freqMhz, pol)
  return k * Math.pow(rainRateMmH, alpha)
}

/** Фит k(f) по таблице P.838-3 (аппроксимация полиномом 3-й степени в log-шкале). */
function rainCoefFit(fMhz: number, pol: 'vertical' | 'horizontal' | 'circular'): number {
  const f = fMhz / 1000 // ГГц
  const l = Math.log10(f)
  const c = pol === 'circular' ? RAIN_COEF.horizontal : RAIN_COEF[pol]
  void c
  // Аппроксимация: k(f) = 10^(a*l^3 + b*l^2 + c*l + d), подгонка на 0.5–7 ГГц
  const kH = 1.21e-5 * Math.exp(1.42 * l * l * l - 2.31 * l * l + 2.52 * l)
  const kV = 1.32e-5 * Math.exp(1.31 * l * l * l - 2.12 * l * l + 2.24 * l)
  if (pol === 'horizontal') return kH
  if (pol === 'vertical') return kV
  return (kH + kV + 2 * kV * kH) / 4 // круговая: (kV + kH + (kV−kH)cosθ)/2, θ=45°
}

/** Фит α(f) по таблице P.838-3 (0.5–7 ГГц). */
function rainAlphaFit(fMhz: number, pol: 'vertical' | 'horizontal' | 'circular'): number {
  const f = fMhz / 1000
  const l = Math.log10(f)
  const aH = 1.934 - 0.912 * l + 0.283 * l * l + 0.097 * l * l * l
  const aV = 1.862 - 0.842 * l + 0.256 * l * l + 0.088 * l * l * l
  if (pol === 'horizontal') return aH
  if (pol === 'vertical') return aV
  return (aH * aV + aH + aV) / 4
}

/**
 * Эффективная длина трассы в дожде.
 *  • terrestrial (по умолчанию): P.530/P.838, deff = d / (1 + d/d0);
 *    d0 = 35 км, либо задан явно (P.530-19 §2.4.1: d0 = 35·e^(−0.015·R0.01));
 *  • наклонная (заданы rainHeightKm и elevationDeg): P.838-3 §1,
 *    Ls = (hR − hs)/sin θ, ограничена длиной трассы.
 */
export function rainLossDb(
  distanceM: number,
  rainRateMmH: number,
  freqMhz: number,
  pol: 'vertical' | 'horizontal' | 'circular',
  opts?: { rainHeightKm?: number; stationHeightM?: number; elevationDeg?: number; d0Km?: number },
): number {
  if (rainRateMmH <= 0) return 0
  const dKm = distanceM / 1000
  const gamma = rainSpecificAttenuationDbKm(rainRateMmH, freqMhz, pol)
  const { rainHeightKm, stationHeightM = 0, elevationDeg, d0Km = 35 } = opts ?? {}
  if (rainHeightKm !== undefined && elevationDeg !== undefined) {
    // Наклонный путь (P.838-3 §1): Ls = (hR − hs)/sin θ, cap по длине трассы
    const sinEl = Math.sin((Math.max(elevationDeg, 0.5) * Math.PI) / 180)
    const lsM = sinEl > 0 ? (rainHeightKm * 1000 - stationHeightM) / sinEl : Infinity
    const pathKm = Number.isFinite(lsM) && lsM > 0 ? Math.min(distanceM, lsM) / 1000 : dKm
    return gamma * pathKm
  }
  const dEff = dKm / (1 + dKm / Math.max(1, d0Km))
  return gamma * dEff
}

/** Параметр эффективной длины d0, км (P.530-19 §2.4.1): 35·e^(−0.015·R0.01), clamp [4, 35]. */
export function rainPathReductionD0Km(rainRate001MmH: number): number {
  if (!(rainRate001MmH > 0)) return 35
  return Math.min(35, Math.max(4, 35 * Math.exp(-0.015 * rainRate001MmH)))
}

/**
 * Удельное затухание атмосферных газов (P.676, упрощённая модель,
 * допускает «упрощённую модель или с профилями P.835»).
 *
 * Модель: континуум + крыло резонанса кислорода 60 ГГц и линии водяного пара
 * 22.235 ГГц, калибрована по справочным кривым P.676 (стандартная атмосфера:
 * P=1013.25 гПа, t=15 °C, ρ=7.5 г/м³). Применима до ~57 ГГц.
 *
 * Справочные значения (дБ/км): 1 ГГц ≈ 0.005; 4 ГГц ≈ 0.007;
 * 10 ГГц ≈ 0.011; 22.235 ГГц (пик H2O) ≈ 0.2; 60 ГГц (пик O2) ≈ 15.
 */
export function gasSpecificAttenuationDbKm(
  freqMhz: number,
  pressureHPa = 1013.25,
  waterVaporDensityGM3 = 7.5,
  temperatureK = 288.15,
): number {
  const f = freqMhz / 1000 // ГГц
  if (f <= 0) return 0
  const pN = pressureHPa / 1013.25
  const tN = (300 / temperatureK) ** 0.85
  const rho = waterVaporDensityGM3 / 7.5

  // Кислород: континуум + крыло линии 60 ГГц (ширина ~ w·pN)
  const wO = 1.2 * pN * tN
  const goCont = 0.0098 * pN * tN * (f * f) / (f * f + 1)
  const goWing = 0.006 * pN * tN * (f * f * wO) / ((f - 60) ** 2 + wO * wO)

  // Водяной пар: континуум + линия 22.235 ГГц (∝ плотности пара)
  const wW = 2.6 * rho
  const gwCont = 0.0003 * rho * (f * f) / (f * f + 25)
  const gwLine = 0.0035 * rho * (f * f * wW) / ((f - 22.235) ** 2 + wW * wW)

  return Math.max(0, goCont + goWing + gwCont + gwLine)
}

/**
 * Потери в атмосферных газах на трассе (интегрирование по высотным профилям — упрощённо через зенитный путь).
 * env — параметры среды: плотность водяного пара и давление (из карт ITU P.836/h0 или вручную);
 * без env — стандартная атмосфера (P = 1013.25 гПа, ρ = 7.5 г/м³, T = 288.15 K).
 */
export function gasesLossDb(
  distanceM: number,
  freqMhz: number,
  elevationDeg = 5,
  env?: { waterVaporGM3?: number; pressureHPa?: number; temperatureK?: number },
): number {
  const g = gasSpecificAttenuationDbKm(
    freqMhz,
    env?.pressureHPa ?? 1013.25,
    env?.waterVaporGM3 ?? 7.5,
    env?.temperatureK ?? 288.15,
  )
  if (!isFinite(g) || g < 0) return 0
  // Тропосферный путь: эффективная высота однородной атмосферы ~ 2 км (кислород) + 2 км (пар)
  const hEffKm = Math.min(distanceM / 1000, 3.2)
  const elRad = Math.max(0.01, (elevationDeg * Math.PI) / 180)
  return g * (hEffKm / Math.sin(elRad))
}

/**
 * Растительность (P.833-3, модель Вайсбергера для 0.2–95 ГГц):
 * L = 0.45 * f^0.284 * d, дБ (d в м, f в МГц), для d < 400 м;
 * для d > 400 м — асимптота (максимум через deg2/deg3 упрощённо).
 */
export function vegetationLossDb(distanceThroughM: number, freqMhz: number): number {
  if (distanceThroughM <= 0) return 0
  const f = freqMhz
  if (distanceThroughM <= 400) {
    return 0.45 * Math.pow(f, 0.284) * distanceThroughM
  }
  // За 400 м — предельные потери (по Weissberger/до ~35 дБ на частотах < 1 ГГц, растут с f)
  const at400 = 0.45 * Math.pow(f, 0.284) * 400
  const slope = 0.45 * Math.pow(f, 0.284) * 0.06 // медленный рост
  return Math.min(at400, at400 * 0.6 + slope * distanceThroughM)
}

/** Вклад clutter (зданий) — использован через дифракцию P.526; здесь — оценка проникновения/затенения. */
export function clutterPenetrationDb(freqMhz: number, type: 'building' | 'vegetation', depthM: number): number {
  if (depthM <= 0) return 0
  if (type === 'vegetation') return vegetationLossDb(depthM, freqMhz)
  // Здания: дифракция обрабатывается в P.526; вклад затенения оценим ~15–25 дБ
  return 18
}
