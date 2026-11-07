/**
 * Валидация входных данных: координаты, частота, высоты,
 * параметры оборудования, динамики. Zod-схемы используются и в UI,
 * и при отправке в Python-сервис.
 */
import { z } from 'zod'
import { LIMITS } from './constants'

export const latLonSchema = z.object({
  lat: z.number().min(-90, 'Широта от −90°').max(90, 'Широта до 90°'),
  lon: z.number().min(-180, 'Долгота от −180°').max(180, 'Долгота до 180°'),
})

export const profilePointSchema = z.object({
  d: z.number().min(0).max(1e7),
  elev: z.number().min(-500).max(9000),
  clutter: z.number().min(0).max(1000),
  total: z.number().min(-500).max(10000),
})

export const pathSchema = z.object({
  points: z.array(latLonSchema).length(2, 'Ровно две точки: A и Б'),
  distanceM: z.number().min(10, 'Минимальная трасса 10 м').max(300000, 'Максимальная трасса 300 км'),
  azimuthDeg: z.number(),
  profile: z.array(profilePointSchema).min(3),
  demStepM: z.number().positive(),
  demSource: z.string().min(1),
})

export const atmosphereSchema = z.object({
  rainRateMmH: z.number().min(0).max(150).optional(),
  rainSource: z.enum(['itu', 'user']).optional(),
  gases: z.boolean(),
  vegetation: z.boolean(),
  waterVaporKgM2: z.number().min(0).max(60).optional(),
  temperatureK: z.number().min(180).max(340).optional(),
  pressureHPa: z.number().min(500).max(1100).optional(),
})

/** Условия из цифровых продуктов ITU-R P.2001-6 (Table 3). */
export const ituEnvironmentSchema = z.object({
  rho50: z.number().min(0).max(60).optional(),
  pr6: z.number().min(0).max(150).optional(),
  rainMassMt: z.number().min(0).max(12000).optional(),
  beta0: z.number().min(0).max(1).optional(),
  rainProbP0: z.number().min(0).max(100).optional(),
  rainRate001: z.number().min(0).max(150).optional(),
  isothermH0Km: z.number().min(0).max(15).optional(),
  dnMedian: z.number().min(-500).max(500).optional(),
  dndz01: z.number().min(-1000).max(500).optional(),
  dnSubSlope: z.number().min(-1000).max(1000).optional(),
  dnSupSlope: z.number().min(-1000).max(1000).optional(),
  tropoZone: z.number().int().min(1).max(14).optional(),
  foEs001: z.number().min(0).max(50).optional(),
  foEs01: z.number().min(0).max(50).optional(),
  foEs10: z.number().min(0).max(50).optional(),
  foEs50: z.number().min(0).max(50).optional(),
  k50: z.number().min(0.5).max(10).optional(),
  k01: z.number().min(0.5).max(10).optional(),
  usedProducts: z.array(z.string().min(1)).max(20),
})

export const calculationInputSchema = z.object({
  frequencyMhz: z
    .number()
    .min(LIMITS.frequencyMinMhz, `Частота от ${LIMITS.frequencyMinMhz} МГц`)
    .max(LIMITS.frequencyMaxMhz, `Частота до ${LIMITS.frequencyMaxMhz} МГц`),
  polarization: z.enum(['vertical', 'horizontal', 'circular']),
  path: pathSchema,
  txHeightM: z.number().min(0.5, 'Высота антенны от 0.5 м').max(5000, 'Высота антенны до 5000 м'),
  rxHeightM: z.number().min(0.5).max(5000),
  timePercents: z.array(z.number().min(0.001).max(99.999)).min(1),
  kFactor: z.number().min(0.5).max(10),
  kFactorSource: z.enum(['itu', 'user']).optional(),
  atmosphere: atmosphereSchema,
  environment: ituEnvironmentSchema.optional(),
  epsilon: z.number().min(1).max(81),
  sigma: z.number().min(0).max(30),
  climateZone: z.string().min(1).max(2),
  aviation: z.boolean().optional(),
})

export const dynamicParamsSchema = z.object({
  altitudeM: z.number().min(5, 'Высота полёта от 5 м').max(20000, 'Высота полёта до 20 км'),
  speedKmh: z
    .number()
    .min(LIMITS.speedMinKmh, `Скорость от ${LIMITS.speedMinKmh} км/ч`)
    .max(LIMITS.speedMaxKmh, `Скорость до ${LIMITS.speedMaxKmh} км/ч`),
  initialElevationDeg: z.number().min(-30).max(90),
  initialAzimuthDeg: z.number().min(0).max(360),
  trajectoryAzimuthDeg: z.number().min(0).max(360),
  durationS: z.number().min(10, 'Длительность от 10 с').max(3600, 'Длительность до 1 ч'),
})

/** Точка файла траектории: координаты, высота (м) и скорость (км/ч) на участке до следующей точки. */
export const routeWaypointSchema = z.object({
  lat: z.number().min(-90, 'Широта от −90°').max(90, 'Широта до 90°'),
  lon: z.number().min(-180, 'Долгота от −180°').max(180, 'Долгота до 180°'),
  altitude: z.number().min(0, 'Высота полёта от 0 м').max(20000, 'Высота полёта до 20 км'),
  speed: z.number().positive('Скорость должна быть больше 0'),
})

/** Файл траектории: любое расширение, строго структура образца. Минимум 4 точки. */
export const routeFileSchema = z.object({
  route: z.object({
    points: z
      .array(routeWaypointSchema)
      .min(4, 'В траектории минимум 4 точки')
      .max(200, 'В траектории не более 200 точек'),
  }),
  tripodHeight: z.number().min(0, 'Высота штатива от 0 м').max(5000, 'Высота штатива до 5000 м'),
})

export function validate<T>(schema: z.ZodType<T>, data: unknown): { ok: true; data: T } | { ok: false; errors: string[] } {
  const r = schema.safeParse(data)
  if (r.success) return { ok: true, data: r.data }
  return {
    ok: false,
    errors: r.error.issues.map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    }),
  }
}
