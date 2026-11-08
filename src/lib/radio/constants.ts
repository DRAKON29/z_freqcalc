import type { ModulationId } from './types'

/** Скорость света, м/с */
export const C_LIGHT = 299_792_458

/** Постоянная Больцмана, Дж/К */
export const K_BOLTZMANN = 1.380649e-23

/** Стандартная температура шума, K (T0) */
export const T0 = 290

/** Радиус Земли (средний), м */
export const R_EARTH = 6_371_000

/** Эффективный радиус Земли для k=4/3, м */
export const EFFECTIVE_R_43 = (4 / 3) * R_EARTH

/** Требуемое Eb/N0 (дБ) для BER≈1e-5, типовые значения. */
export const MODULATIONS: Record<ModulationId, { ebN0Db: number; bitsPerSymbol: number; label: string }> = {
  BPSK: { ebN0Db: 9.6, bitsPerSymbol: 1, label: 'BPSK' },
  QPSK: { ebN0Db: 9.6, bitsPerSymbol: 2, label: 'QPSK' },
  '16QAM': { ebN0Db: 14.0, bitsPerSymbol: 4, label: '16-QAM' },
  '64QAM': { ebN0Db: 18.5, bitsPerSymbol: 6, label: '64-QAM' },
}

/** Ограничения входных данных */
export const LIMITS = {
  frequencyMinMhz: 500,
  frequencyMaxMhz: 7000,
  speedMinKmh: 100,
  speedMaxKmh: 200,
  ituMapMaxFileBytes: 700 * 1024 * 1024, // 700 МБ на файл
  ituMapMaxZipBytes: 1024 * 1024 * 1024, // 1 ГБ на zip
}

/** Порог FPS для анимации траектории*/
export const FPS_THRESHOLD = 24

/** kTB при 290 K, дБм: 10*log10(k*T0*1e3) ≈ -173.98 */
export const KTB_DBM_HZ = 10 * Math.log10(K_BOLTZMANN * T0 * 1e3)

export const CLIMATE_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q'] as const

/**
 * Интенсивность дождя R(0.01 %), мм/ч, по зонам дождя ITU-R (P.837-3, Table 1).
 * Оценка по умолчанию для availability-отчёта (P.530), когда нет ни цифровых
 * продуктов P.837-6, ни ручного ввода; точнее — загрузить карты ITU.
 */
export const RAIN_ZONE_R001_MMH: Record<string, number> = {
  A: 8, B: 12, C: 15, D: 19, E: 22, F: 28, G: 30, H: 32, J: 35, K: 42, L: 45, M: 48, N: 53, P: 75, Q: 96,
}
