/**
 * Проверка: все 14 реальных файлов продуктов ITU-R P.2001-6 из upload/
 * разбираются парсером приложения и дают осмысленные значения для Москвы.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findItuGridSpec, parseItuGrid, interpolateItu } from '../src/lib/radio/itu-grid'
import { ituEnvironmentAt, kFromDn } from '../src/lib/radio/itu-env'

const FIX = path.resolve(process.cwd(), 'tests/fixtures/itu')
const FILES = [
  'DN_Median.txt', 'DN_SubSlope.txt', 'DN_SupSlope.txt', 'dndz_01.txt',
  'Esarain_Pr6_v5.txt', 'Esarain_Mt_v5.txt', 'Esarain_Beta_v5.txt',
  'h0.txt', 'surfwv_50_fixed.txt',
  'FoEs0.1.txt', 'FoEs01.txt', 'FoEs10.txt', 'FoEs50.txt',
  'TropoClim.txt',
]

const MOSCOW_A = { lat: 55.7558, lon: 37.6173 }
const MOSCOW_B = { lat: 55.9, lon: 38.2 }

const grids: Record<string, ReturnType<typeof parseItuGrid>> = {}
let failed = 0
for (const f of FILES) {
  try {
    const text = readFileSync(path.join(FIX, f), 'utf-8')
    const grid = parseItuGrid(f, text)
    grids[grid.spec.name] = grid
    const v = interpolateItu(grid, MOSCOW_A.lat, MOSCOW_A.lon)
    console.log(`OK  ${f.padEnd(22)} сетка ${grid.rows}×${grid.cols}  Москва: ${v.toFixed(3)}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${f}: ${e instanceof Error ? e.message : e}`)
  }
}

const env = ituEnvironmentAt(grids, MOSCOW_A, MOSCOW_B)
console.log('\n--- Условия для Москвы (среднее A и Б) ---')
console.log(`ΔN median: ${env.dnMedian?.toFixed(1)} N/км  → k50 = ${env.k50?.toFixed(3)} (ожидалось ~1.32)`)
console.log(`dN1 0.1%:  ${env.dndz01?.toFixed(1)} N/км  → k01 = ${env.k01?.toFixed(2)}`)
console.log(`ρ50:       ${env.rho50?.toFixed(2)} г/м³`)
console.log(`Pr6:       ${env.pr6?.toFixed(1)} мм/ч`)
console.log(`Mt:        ${env.rainMassMt?.toFixed(0)} кг/м²/год`)
console.log(`β:         ${env.beta0?.toFixed(3)} (доля года)`)
console.log(`P0:        ${env.rainProbP0?.toFixed(2)} % (P.837-6, шаг 4)`)
console.log(`R0.01:     ${env.rainRate001?.toFixed(1)} мм/ч (P.837-6, шаг 5)`)
console.log(`h0:        ${env.isothermH0Km?.toFixed(2)} км`)
console.log(`TropoClim: зона ${env.tropoZone}`)
console.log(`foEs 0.1/1/10/50: ${env.foEs001?.toFixed(2)} / ${env.foEs01?.toFixed(2)} / ${env.foEs10?.toFixed(2)} / ${env.foEs50?.toFixed(2)} МГц`)
console.log(`Продуктов в среде: ${env.usedProducts.length} из 14`)

// Физические sanity-проверки
const checks: [string, boolean][] = [
  ['k50 в диапазоне 1.2…1.5 (стандартная рефракция для Москвы)', env.k50! > 1.2 && env.k50! < 1.5],
  ['ΔN отрицательный', env.dnMedian! < 0],
  ['dN1 сильнее медианного (волновод 0.1%)', env.dndz01! < env.dnMedian!],
  ['ρ50 в разумных пределах 1…10 г/м³', env.rho50! > 1 && env.rho50! < 10],
  ['Pr6 > 20 мм/ч (умеренный климат)', env.pr6! > 20 && env.pr6! < 80],
  ['Mt — суммарная масса дождя 300…800 кг/м²/год для Москвы', env.rainMassMt! > 300 && env.rainMassMt! < 800],
  ['β — доля года 0…1', env.beta0! > 0 && env.beta0! < 1],
  ['P0 — вероятность дождя 1…6 %', env.rainProbP0! > 1 && env.rainProbP0! < 6],
  ['R0.01 (P.837-6) 20…60 мм/ч', env.rainRate001! > 20 && env.rainRate001! < 60],
  ['h0 (изотерма 0 °C) 1…4 км', env.isothermH0Km! > 1 && env.isothermH0Km! < 4],
  ['зона TropoClim 1…14', env.tropoZone! >= 1 && env.tropoZone! <= 14],
  ['foEs50 < foEs10 < foEs01 < foEs0.1', env.foEs50! < env.foEs10! && env.foEs10! < env.foEs01! && env.foEs01! < env.foEs001!],
  ['все 14 продуктов в среде', env.usedProducts.length === 14],
]
let bad = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK ' : 'BAD'} ${name}`)
  if (!ok) bad++
}
process.exit(failed + bad > 0 ? 1 : 0)
