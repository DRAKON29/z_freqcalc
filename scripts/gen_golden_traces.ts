/**
 * Генератор эталонных трасс для кросс-движковой валидации (роадмап 3.4).
 *
 * Формирует tests/fixtures/golden-traces.json: фиксированные профили трасс
 * (без цифровых продуктов ITU — обе lite-реализации должны совпадать) и
 * снапшоты TS-движка (computeP2001Lite/computeFsplP526). Python-половину
 * снапшотов дозаполняет scripts/gen_golden_traces_py.py (p2001_lite.calculate).
 *
 * Запуск: bun scripts/gen_golden_traces.ts
 * Снапшоты регенерируются осознанно: только при намеренном изменении модели.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSyntheticDem, buildProfile } from '../src/lib/radio/terrain'
import { distanceM, bearingDeg } from '../src/lib/radio/coordinates'
import { computeP2001Lite, computeFsplP526 } from '../src/lib/radio/p2001lite'
import type { CalculationInput, ProfilePoint } from '../src/lib/radio/types'

const REPO = join(import.meta.dir, '..')
const FIXTURE = join(REPO, 'tests', 'fixtures', 'golden-traces.json')

function profileFlat(lengthM: number, baseM: number, stepM: number): ProfilePoint[] {
  const n = Math.round(lengthM / stepM) + 1
  return Array.from({ length: n }, (_, i) => ({
    d: i * stepM,
    elev: baseM,
    clutter: 0,
    total: baseM,
  }))
}

function profileTwoHills(): ProfilePoint[] {
  // Опорный случай дифракции (тест 1.3): 30 км, рёбра 60 м на 10/20 км над базой 50 м
  const pts: ProfilePoint[] = []
  for (let d = 0; d <= 30000; d += 100) {
    const hill = Math.abs(d - 10000) < 60 || Math.abs(d - 20000) < 60 ? 60 : 0
    pts.push({ d, elev: 50 + hill, clutter: 0, total: 50 + hill })
  }
  return pts
}

function profileRolling(lengthM: number, stepM: number): ProfilePoint[] {
  // Мягко пересечённая местность: синус 40 м с периодом 8 км + уклон 2 м/км
  const pts: ProfilePoint[] = []
  for (let d = 0; d <= lengthM; d += stepM) {
    const elev = 100 + 40 * Math.sin((d / 8000) * 2 * Math.PI) + (d / 1000) * 2
    pts.push({ d, elev: Math.round(elev * 10) / 10, clutter: 0, total: 0 })
  }
  for (const p of pts) p.total = p.elev
  return pts
}

function moscowDefaultInput(): CalculationInput {
  // Дефолтная трасса приложения (контрольный случай 173.0 дБ у lite):
  // синтетический DEM, Москва A→Б, 2400 МГц
  const A = { lat: 55.7558, lon: 37.6173 }
  const B = { lat: 55.8305, lon: 37.8501 }
  const dem = createSyntheticDem()
  const profile = buildProfile(A, B, dem)
  return {
    frequencyMhz: 2400,
    polarization: 'vertical',
    path: {
      points: [A, B],
      distanceM: distanceM(A, B),
      azimuthDeg: bearingDeg(A, B),
      profile,
      demStepM: dem.resolutionM,
      demSource: 'golden-fixture',
    },
    txHeightM: 30,
    rxHeightM: 10,
    timePercents: [50, 90, 99, 99.9],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
  }
}

function inputOf(overrides: Partial<CalculationInput> & { profile: ProfilePoint[]; distanceM: number }): CalculationInput {
  return {
    frequencyMhz: 2400,
    polarization: 'vertical',
    path: {
      points: [
        { lat: 55.0, lon: 37.0 },
        { lat: overrides.distanceM / 111320 + 55.0, lon: 37.0 },
      ],
      distanceM: overrides.distanceM,
      azimuthDeg: 0,
      profile: overrides.profile,
      demStepM: overrides.profile[1] ? overrides.profile[1].d - overrides.profile[0].d : 30,
      demSource: 'golden-fixture',
    },
    txHeightM: 30,
    rxHeightM: 10,
    timePercents: [50, 90, 99, 99.9],
    kFactor: 4 / 3,
    atmosphere: { gases: false, vegetation: false },
    epsilon: 15,
    sigma: 0.005,
    climateZone: 'K',
    ...overrides,
  }
}

interface GoldenSnapshot {
  medianLossDb: number
  byTimePercent: { percent: number; lossDb: number }[]
  breakdown: Record<string, number>
}
interface GoldenCase {
  name: string
  description: string
  input: CalculationInput
  ts?: GoldenSnapshot
  py?: GoldenSnapshot
}

const cases: GoldenCase[] = [
  {
    name: 'flat_los_10km',
    description: 'Плоская LOS 10 км, 2400 МГц, антенны 30/10 м, k=4/3',
    input: inputOf({ profile: profileFlat(10000, 150, 90), distanceM: 10000 }),
  },
  {
    name: 'moscow_default',
    description: 'Контрольная трасса приложения: Москва A→Б на синтетическом DEM, 2400 МГц',
    input: moscowDefaultInput(),
  },
  {
    name: 'two_hill_nlos_30km',
    description: 'Два препятствия 60 м на 10/20 км, база 50 м, 30 км, антенны 20 м — опорный случай дифракции (1.3)',
    input: inputOf({ profile: profileTwoHills(), distanceM: 30000, txHeightM: 20, rxHeightM: 20 }),
  },
  {
    name: 'transhorizon_150km',
    description: 'Перегоризонтная трасса 150 км, лёгкий подъём рельефа, 2400 МГц',
    input: inputOf({ profile: profileRolling(150000, 500), distanceM: 150000 }),
  },
  {
    name: 'short_500m',
    description: 'Короткая трасса 500 м, плоская, антенны 10/1.5 м',
    input: inputOf({ profile: profileFlat(500, 150, 50), distanceM: 500, txHeightM: 10, rxHeightM: 1.5 }),
  },
  {
    name: 'rain_5800_user',
    description: '5800 МГц, дождь вручную R0.01 = 30 мм/ч (P.838/P.530), 10 км',
    input: inputOf({ profile: profileFlat(10000, 150, 90), distanceM: 10000, frequencyMhz: 5800, atmosphere: { gases: true, vegetation: false, rainRateMmH: 30, rainSource: 'user' } }),
  },
  {
    name: 'horizontal_pol_2400',
    description: 'Горизонтальная поляризация (влияет на P.838), 10 км',
    input: inputOf({ profile: profileFlat(10000, 150, 90), distanceM: 10000, polarization: 'horizontal' }),
  },
  {
    name: 'subrefraction_k067_40km',
    description: 'Подрефракция k=2/3, 40 км, пересечённый рельеф',
    input: inputOf({ profile: profileRolling(40000, 100), distanceM: 40000, kFactor: 2 / 3 }),
  },
  {
    name: 'fspl_p526_60km',
    description: 'Модель FSPL+P.526 (computeFsplP526): 60 км, пересечённый рельеф, k=4/3',
    input: inputOf({ profile: profileRolling(60000, 150), distanceM: 60000 }),
  },
]

function snapshot(model: 'p2001' | 'fspl-p526', input: CalculationInput): GoldenSnapshot {
  const r = model === 'p2001' ? computeP2001Lite(input) : computeFsplP526(input)
  const breakdown: Record<string, number> = {}
  for (const [k, v] of Object.entries(r.breakdown)) {
    if (typeof v === 'number') breakdown[k] = Math.round(v * 1e6) / 1e6
  }
  return {
    medianLossDb: Math.round(r.medianLossDb * 1e6) / 1e6,
    byTimePercent: r.byTimePercent.map((t) => ({
      percent: t.percent,
      lossDb: Math.round(t.lossDb * 1e6) / 1e6,
    })),
    breakdown,
  }
}

mkdirSync(join(REPO, 'tests', 'fixtures'), { recursive: true })

let existing: { cases?: GoldenCase[]; [k: string]: unknown } = {}
try {
  existing = JSON.parse(readFileSync(FIXTURE, 'utf-8'))
} catch {
  // первый прогон — файла ещё нет
}

const prevPy = new Map((existing.cases ?? []).map((c) => [c.name, c.py]))
for (const c of cases) {
  c.ts = snapshot('p2001', c.input)
  if (c.name === 'fspl_p526_60km') c.ts = snapshot('fspl-p526', c.input)
  const py = prevPy.get(c.name)
  if (py) c.py = py // python-снапшоты сохраняются между регенерациями
}

const doc = {
  /** Кросс-движковая валидация lite-движков (роадмап 3.4, подход golden ±1 дБ
   * Meshtastic Site Planner). Допуск cross между TS и python — 1.0 дБ;
   * самопроверка снапшота — 0.01 дБ. Регенерация: bun scripts/gen_golden_traces.ts,
   * затем python scripts/gen_golden_traces_py.py (заполняет py-снапшоты). */
  toleranceCrossDb: 1.0,
  toleranceSnapshotDb: 0.01,
  cases,
}

writeFileSync(FIXTURE, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
console.log(`golden-traces.json: ${cases.length} трасс, TS-снапшоты обновлены`)
for (const c of cases) {
  console.log(`  ${c.name}: ts=${c.ts?.medianLossDb.toFixed(1)} дБ, py=${c.py ? c.py.medianLossDb.toFixed(1) + ' дБ' : '— (запустите gen_golden_traces_py.py)'}`)
}
