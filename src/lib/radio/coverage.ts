/**
 * Круговая диаграмма радиосигнала (polar coverage diagram):
 *  • по азимутам с заданным шагом строится профиль рельефа от передатчика (A);
 *  • для контрольных дальностей по каждому азимуту считается медианный бюджет
 *    линии той же цепочкой механизмов, что и основной расчёт
 *    (FSPL P.525 + дифракция P.526 + здания/растительность, P.2001-lite медиана 50 %);
 *  • граница зоны связи — максимальная дальность с запасом (link margin) ≥ 0 дБ;
 *    зона уверенного приёма — запас ≥ 10 дБ;
 *  • сетка высот для отрисовки рельефа подложкой на диаграмме.
 */
import { computeFsplP526 } from './p2001lite'
import { computeLinkBudget } from './budget'
import { destination } from './coordinates'
import { buildProfile, pointInTiles, type DemSource } from './terrain'
import { fresnelRadiusM } from './fresnel'
import { earthBulgeM } from './fspl'
import type { CalculationInput, EquipmentParams, ProfilePoint } from './types'
import type { HgtTile } from './terrain'

/** Шаг фиксированного списка радиусов, км */
export const RADIUS_STEP_KM = 15
/** Максимальный радиус расчёта, км */
export const RADIUS_MAX_KM = 200
/** Автоматический радиус: длина трассы + 10 км */
export const AUTO_EXTRA_KM = 10
/** Порог зоны уверенного приёма, дБ */
export const STRONG_MARGIN_DB = 10
/** Критерий просвета «строго по Френелю»: доля первой зоны (этап UX.3). */
export const FRESNEL_CRITERION = 0.6
/** Критерий «уверенного приёма» в режиме Френеля: полный просвет F1. */
export const FRESNEL_STRONG = 1.0

/**
 * Режим преград кругового покрытия (этап UX.3, референс antenna.2tg.dev):
 *  • model    — полная цепочка механизмов основного расчёта (FSPL + P.526 + clutter);
 *  • fspl     — только FSPL, без рельефа и препятствий (оптимистичная);
 *  • geometry — жёсткая геометрия: рельеф/препятствия выше прямой видимости
 *               (с учётом кривизны Земли) обрывают зону (худший случай);
 *  • fresnel  — инженерный критерий: зона там, где просвет ≥ 0.6·F1
 *               (уверенный приём — полный просвет F1).
 */
export type CoverageMode = 'model' | 'fspl' | 'geometry' | 'fresnel'

export interface RadiusOption {
  /** Значение радиуса, км */
  valueKm: number
  /** Подпись в выпадающем списке */
  label: string
  /** Автоматический вариант «длина трассы + 10 км» */
  auto?: boolean
}

/** Автоматический радиус: длина трассы + 10 км, но не больше 200 км. */
export function autoRadiusKm(routeKm: number): number {
  const v = routeKm + AUTO_EXTRA_KM
  return Math.min(RADIUS_MAX_KM, Math.round(v * 10) / 10)
}

/**
 * Выпадающий список радиуса расчёта: «длина трассы + 10 км» (по умолчанию)
 * и фиксированные значения до 200 км с шагом 15 км.
 */
export function radiusOptions(routeKm: number): RadiusOption[] {
  const auto = autoRadiusKm(routeKm)
  const options: RadiusOption[] = [
    { valueKm: auto, label: `Длина трассы + 10 км (${auto.toFixed(1)} км)`, auto: true },
  ]
  for (let r = RADIUS_STEP_KM; r < RADIUS_MAX_KM; r += RADIUS_STEP_KM) {
    // не дублируем совпадающее с автоматическим значение
    if (Math.abs(r - auto) < 0.05) continue
    options.push({ valueKm: r, label: `${r} км` })
  }
  options.push({ valueKm: RADIUS_MAX_KM, label: `${RADIUS_MAX_KM} км` })
  return options
}

/** Шаг колец сетки дальности на диаграмме: «красивые» значения, 4–6 колец. */
export function ringStepKm(radiusKm: number): number {
  for (const s of [1, 2, 5, 10, 15, 25, 50, 100]) {
    if (radiusKm / s <= 6) return s
  }
  return 100
}

/** Один азимут диаграммы. */
export interface CoverageRadial {
  /** Азимут, град (0 = север, по часовой) */
  azDeg: number
  /** Максимальная дальность с запасом ≥ 0 дБ, км (null — связи нет на всём радиусе) */
  maxKm: number | null
  /** Запас на границе зоны связи, дБ */
  marginAtMaxDb: number | null
  /** Дальность зоны уверенного приёма (запас ≥ STRONG_MARGIN_DB), км */
  strongKm: number | null
}

/**
 * Уровни сигнала по контрольной сетке (этап 2.5, покрытие на карте):
 * margins[azIdx * distCount + distIdx] — link margin (дБ) тест-точки
 * (NaN — точка не считалась: геометрический режим оборвался на блоке).
 * distKm — равномерная сетка дальностей (radiusKm * k / distCount).
 */
export interface CoverageLevels {
  /** Дальности контрольных точек, км (длина distCount) */
  distKm: number[]
  /** Число азимутов */
  azCount: number
  /** Плоская матрица уровней: azIdx * distCount + distIdx */
  margins: Float32Array
}

export interface CoverageStats {
  /** Доля азимутов с наличием связи, % */
  coveredAzimuthPercent: number
  /** Оценка площади покрытия от площади круга расчёта, % */
  areaPercent: number
  /** Мин/медиана/макс границы зоны связи по азимутам, км */
  minKm: number | null
  medianKm: number | null
  maxKm: number | null
  /** Границы зоны уверенного приёма, км */
  strongMinKm: number | null
  strongMaxKm: number | null
  /** Доля контрольных точек вне тайлов рельефа, % (только при загруженных тайлах) */
  outsideTilesPercent?: number
}

export interface CoverageResult {
  radiusKm: number
  azimuthStepDeg: number
  radials: CoverageRadial[]
  stats: CoverageStats
  /** Уровни по контрольной сетке (этап 2.5) — для оверлея на карте */
  levels: CoverageLevels
  frequencyMhz: number
  routeKm: number
  routeAzDeg: number
  engineUsed: string
  computedAtMs: number
}

export interface ComputeCoverageParams {
  input: CalculationInput
  dem: DemSource
  clutterAt?: (lat: number, lon: number) => { type: string; height: number } | null
  equipment: EquipmentParams
  radiusKm: number
  /** Шаг по азимуту, град (по умолчанию 5 → 72 азимута) */
  azimuthStepDeg?: number
  /** Тайлы рельефа — для оценки покрытия круга данными */
  hgtTiles?: HgtTile[]
  /** Режим преград (этап UX.3): по умолчанию 'model' — как в основном расчёте */
  mode?: CoverageMode
}

/**
 * Срез профиля до дальности dM с точным конечным интерполированным узлом
 * и прореживанием до maxPoints узлов (сохраняются первый и последний).
 */
export function sliceProfile(profile: ProfilePoint[], dM: number, maxPoints: number): ProfilePoint[] {
  const out: ProfilePoint[] = []
  for (const p of profile) {
    if (p.d <= dM + 1e-6) out.push(p)
    else break
  }
  const last = out[out.length - 1]
  if (last && dM - last.d > 1) {
    const next = profile[out.length]
    if (next && next.d > last.d) {
      const t = (dM - last.d) / (next.d - last.d)
      const elev = last.elev + (next.elev - last.elev) * t
      const cl = last.clutter + (next.clutter - last.clutter) * t
      out.push({ d: dM, elev, clutter: cl, total: elev + cl })
    }
  }
  if (out.length === 0) return out
  if (out.length <= maxPoints) return out

  const stride = out.length / maxPoints
  const decimated: ProfilePoint[] = []
  let lastD = -1
  for (let i = 0; i < maxPoints; i++) {
    const p = out[Math.min(out.length - 1, Math.floor(i * stride))]
    if (p.d > lastD) {
      decimated.push(p)
      lastD = p.d
    }
  }
  const end = out[out.length - 1]
  if (decimated[decimated.length - 1].d !== end.d) decimated.push(end)
  return decimated
}

/**
 * Худший по профилю среза (до дальности dM) критерий «просвет/F1»: прямая
 * видимость с учётом кривизны Земли против радиуса F1 в каждой промежуточной
 * точке. Используется режимами geometry/fresnel (этап UX.3).
 */
function worstClearanceRatio(
  profile: ProfilePoint[],
  dM: number,
  txHeightM: number,
  rxHeightM: number,
  kFactor: number,
  freqMhz: number,
): number {
  const txBase = profile[0]?.elev ?? 0
  const rxBase = profile[profile.length - 1]?.elev ?? 0
  const txH = txBase + txHeightM
  const rxH = rxBase + rxHeightM
  let worst = Infinity
  for (const p of profile) {
    if (p.d <= 0 || p.d >= dM) continue // концы — точки антенн
    const los = txH + ((rxH - txH) * p.d) / dM
    const clearance = los - earthBulgeM(p.d, dM, kFactor) - p.total
    const f1 = fresnelRadiusM(p.d, dM, freqMhz)
    const ratio = f1 > 0 ? clearance / f1 : Infinity
    if (ratio < worst) worst = ratio
  }
  return worst
}

/**
 * Расчёт круговой диаграммы: для каждого азимута — максимальная дальность,
 * на которой линия обеспечена (по режиму преград: запас ≥ 0 дБ / LOS /
 * просвет 0.6·F1), с учётом рельефа и препятствий вдоль луча.
 */
export function computeCoverage({
  input,
  dem,
  clutterAt,
  equipment,
  radiusKm,
  azimuthStepDeg = 5,
  hgtTiles,
  mode = 'model',
}: ComputeCoverageParams): CoverageResult {
  const t0 = Date.now()
  const radius = isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 15
  const radiusM = radius * 1000
  const center = input.path.points[0]
  const step = azimuthStepDeg > 0 && azimuthStepDeg <= 30 ? azimuthStepDeg : 5

  // Геометрические режимы: классификация по просвету, не по бюджету;
  // зона — непрерывный от центра участок до первого «блока» по критерию
  const geometric = mode === 'geometry' || mode === 'fresnel'
  const geometricThreshold = mode === 'geometry' ? 0 : FRESNEL_CRITERION
  const kEff = input.environment?.k50 ?? input.kFactor

  // Уровни по контрольной сетке (этап 2.5): margins[azIdx * distCount + distIdx],
  // NaN — точка не считалась (геометрический режим оборвался на блоке)
  const azCount = Math.round(360 / step)
  const nTests = 60
  const distKm: number[] = []
  for (let k = 1; k <= nTests; k++) distKm.push((radius * k) / nTests)
  const margins = new Float32Array(azCount * nTests)
  margins.fill(NaN)

  const radials: CoverageRadial[] = []
  let insideTiles = 0
  let totalTestPoints = 0

  for (let az = 0; az < 360; az += step) {
    const edge = destination(center, radiusM, az)
    const profile = buildProfile(center, edge, dem, clutterAt)
    const radial: CoverageRadial = { azDeg: az, maxKm: null, marginAtMaxDb: null, strongKm: null }
    const azIdx = Math.round(az / step)

    let strongBroken = false
    for (let k = 1; k <= nTests; k++) {
      const d = (radiusM * k) / nTests
      if (d < 100) continue
      const sliced = sliceProfile(profile, d, 240)
      if (sliced.length < 3) continue

      const point = destination(center, d, az)
      if (hgtTiles && hgtTiles.length > 0) {
        totalTestPoints++
        if (pointInTiles(point.lat, point.lon, hgtTiles)) insideTiles++
      }

      if (geometric) {
        const worst = worstClearanceRatio(sliced, d, input.txHeightM, input.rxHeightM, kEff, input.frequencyMhz)
        if (worst < geometricThreshold) break // первый блок обрывает зону (непрерывность от центра)
        const dKm = d / 1000
        radial.maxKm = dKm
        if (mode === 'fresnel') {
          if (!strongBroken && worst >= FRESNEL_STRONG) radial.strongKm = dKm
          else if (worst < FRESNEL_STRONG) strongBroken = true
        }
        continue
      }

      const testInput: CalculationInput = {
        ...input,
        ...(mode === 'fspl'
          ? { atmosphere: { ...input.atmosphere, vegetation: false, gases: false } }
          : {}),
        path: {
          ...input.path,
          points: [center, point],
          distanceM: d,
          azimuthDeg: az,
          // «Только FSPL»: препятствия (clutter) исключаются из среза
          profile:
            mode === 'fspl'
              ? sliced.map((p) => ({ ...p, clutter: 0, total: p.elev }))
              : sliced,
        },
      }
      const prop = computeFsplP526(testInput, mode === 'fspl' ? { skipDiffraction: true } : undefined)
      const budget = computeLinkBudget(testInput, equipment, prop)
      const margin = budget.linkMarginDb
      margins[azIdx * nTests + (k - 1)] = margin
      const dKm = d / 1000
      if (margin >= 0) {
        radial.maxKm = dKm
        radial.marginAtMaxDb = margin
      }
      if (margin >= STRONG_MARGIN_DB) radial.strongKm = dKm
    }
    radials.push(radial)
  }

  const covered = radials.filter((r) => r.maxKm !== null).map((r) => r.maxKm as number).sort((a, b) => a - b)
  const strong = radials.filter((r) => r.strongKm !== null).map((r) => r.strongKm as number)
  const medianKm = covered.length
    ? covered.length % 2 === 1
      ? covered[(covered.length - 1) / 2]
      : (covered[covered.length / 2 - 1] + covered[covered.length / 2]) / 2
    : null

  let areaPercent = 0
  for (const r of radials) {
    if (r.maxKm !== null) areaPercent += (r.maxKm / radius) ** 2
  }
  areaPercent = (areaPercent / radials.length) * 100

  const stats: CoverageStats = {
    coveredAzimuthPercent: (covered.length / radials.length) * 100,
    areaPercent,
    minKm: covered.length ? covered[0] : null,
    medianKm,
    maxKm: covered.length ? covered[covered.length - 1] : null,
    strongMinKm: strong.length ? Math.min(...strong) : null,
    strongMaxKm: strong.length ? Math.max(...strong) : null,
  }
  if (hgtTiles && hgtTiles.length > 0 && totalTestPoints > 0) {
    stats.outsideTilesPercent = Math.max(0, Math.round((1 - insideTiles / totalTestPoints) * 100))
  }

  return {
    radiusKm: radius,
    azimuthStepDeg: step,
    radials,
    stats,
    levels: { distKm, azCount, margins },
    frequencyMhz: input.frequencyMhz,
    routeKm: input.path.distanceM / 1000,
    routeAzDeg: input.path.azimuthDeg,
    engineUsed:
      mode === 'fspl'
        ? 'TS: FSPL (P.525) — без рельефа и препятствий (оптимистичная оценка)'
        : mode === 'geometry'
          ? 'TS: геометрия LOS — рельеф/препятствия выше прямой обрывают зону (худший случай)'
          : mode === 'fresnel'
            ? 'TS: критерий просвета 0.6·F1 (K из ввода; уверенный приём — полный F1)'
            : 'TS: FSPL (P.525) + P.526 + clutter — медиана 50 % времени',
    computedAtMs: Date.now() - t0,
  }
}

/** ---------- Сетка высот для отрисовки рельефа на диаграмме ---------- */

export interface ElevationGrid {
  /** Число ячеек по стороне */
  n: number
  /** Половина стороны квадрата выборки, м (= радиус расчёта) */
  halfM: number
  /** Высоты, построчно с северо-западного угла, м */
  data: Float32Array
  minElev: number
  maxElev: number
  /** true — данные из тайлов: нулевые высоты вне покрытия трактуем как «нет данных» */
  nodataZero: boolean
}

/**
 * Выборка высот по квадратной сетке вокруг центра (локальная плоская
 * аппроксимация широты/долготы) для подложки круговой диаграммы.
 */
export function sampleElevationGrid(
  dem: DemSource,
  center: { lat: number; lon: number },
  radiusM: number,
  n = 160,
  nodataZero = false,
): ElevationGrid {
  const halfM = radiusM
  const data = new Float32Array(n * n)
  let min = Infinity
  let max = -Infinity
  const cosLat = Math.cos((center.lat * Math.PI) / 180)
  for (let row = 0; row < n; row++) {
    // row 0 — северный край
    const dNorth = halfM - ((row + 0.5) / n) * 2 * halfM
    for (let col = 0; col < n; col++) {
      const dEast = -halfM + ((col + 0.5) / n) * 2 * halfM
      const dLat = dNorth / 111320
      const dLon = dEast / (111320 * cosLat)
      const elev = dem.elevationAt(center.lat + dLat, center.lon + dLon)
      data[row * n + col] = elev
      if (elev < min) min = elev
      if (elev > max) max = elev
    }
  }
  return {
    n,
    halfM,
    data,
    minElev: min === Infinity ? 0 : min,
    maxElev: max === -Infinity ? 0 : max,
    nodataZero,
  }
}
