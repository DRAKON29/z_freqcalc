/**
 * Шумовой порог по ITU-R P.372-17 (§6.1.1 «Outdoor man-made noise», Table 1).
 *
 * Медиана техногенного шума: Fam = c − d·lg f, f в МГц, Fa в дБ выше kT0b:
 *   city (business)   c = 76.8, d = 27.7
 *   residential       c = 72.5, d = 27.7
 *   rural             c = 67.2, d = 27.7
 *   quiet rural       c = 53.6, d = 28.6
 *
 * Заявленная применимость фитов — 0.3–250 МГц. В полосе приложения
 * (500–7000 МГц) значения экстраполируются и уходят в минус выше
 * ~0.27–0.61 ГГц; физический пол — 0 дБ (антенна наземной станции видит
 * тепловой фон Земли T0 и не может быть «холоднее» его, диаграмма неизвестна).
 * Атмосферный и галактический шум на 0.5–7 ГГц пренебрежимы
 * (галактический фон ≈ 2.7 K → −20 дБ, газы ясной атмосферы < 0.1 дБ).
 *
 * Комбинация с приёмником (P.372, Part 7 — сложение шум-факторов в линейных
 * величинах): f_сумм = f_rx + f_a − 1, N = kTB + 10·lg(f_сумм).
 * При Fa = 0 дБ → f_a = 1 → N = kTB + NF (прежнее поведение).
 */
import type { NoiseEnvironment } from './types'

/** Коэффициенты фитов P.372-17 Table 1: Fam = c − d·lg f (f в МГц). */
export const P372_MAN_MADE_FITS: Record<Exclude<NoiseEnvironment, 'none'>, { c: number; d: number }> = {
  business: { c: 76.8, d: 27.7 },
  residential: { c: 72.5, d: 27.7 },
  rural: { c: 67.2, d: 27.7 },
  'quiet-rural': { c: 53.6, d: 28.6 },
}

/** Русские подписи окружений для UI. */
export const NOISE_ENVIRONMENT_LABELS: Record<NoiseEnvironment, string> = {
  none: 'Не учитывать (kTB + NF)',
  'quiet-rural': 'Тихая сельская местность',
  rural: 'Сельская местность',
  residential: 'Жилая застройка',
  business: 'Город / бизнес',
}

/**
 * Медианный техногенный шум Fa (P.372-17, Table 1), дБ выше kT0.
 * Экстраполяция за 250 МГц зажата снизу на 0 дБ.
 */
export function manMadeNoiseFaDb(environment: NoiseEnvironment, freqMhz: number): number {
  const fit = P372_MAN_MADE_FITS[environment]
  if (!fit || !(freqMhz > 0)) return 0
  const fa = fit.c - fit.d * Math.log10(freqMhz)
  return Math.min(60, Math.max(0, fa))
}

/**
 * Мощность шума системы с учётом шума антенны (P.372 Part 7):
 * N = kTB + 10·lg(f_rx + f_a − 1); при fa = 1 (Fa = 0) → kTB + NF.
 */
export function systemNoisePowerDbm(ktbDbm: number, nfDb: number, faDb: number): number {
  const fRx = Math.pow(10, nfDb / 10)
  const fA = Math.pow(10, faDb / 10)
  return ktbDbm + 10 * Math.log10(Math.max(1e-6, fRx + fA - 1))
}
