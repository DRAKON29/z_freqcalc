/**
 * Кросс-движковая golden-валидация (роадмап 3.4, допуск ±1 дБ — подход
 * Meshtastic Site Planner). Один fixtures-файл гоняется и здесь (TS), и
 * pytest'ом (mini-services/radio-service/tests/test_golden_traces.py):
 * каждый движок проверяется против СВОЕГО снапшота (±0.01 дБ — защита от
 * регрессий) и против снапшота ДРУГОГО движка (±1 дБ — зеркальность портов).
 *
 * Регенерация снапшотов: bun scripts/gen_golden_traces.ts &&
 * python scripts/gen_golden_traces_py.py — только при намеренном изменении модели.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { computeP2001Lite, computeFsplP526 } from '../src/lib/radio/p2001lite'
import type { CalculationInput, PropagationResult } from '../src/lib/radio/types'

interface GoldenSnapshot {
  medianLossDb: number
  byTimePercent: { percent: number; lossDb: number }[]
  breakdown: Record<string, number>
}
interface GoldenCase {
  name: string
  description: string
  input: CalculationInput
  ts: GoldenSnapshot
  py: GoldenSnapshot
}
const doc = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'golden-traces.json'), 'utf-8'),
) as { toleranceCrossDb: number; toleranceSnapshotDb: number; cases: GoldenCase[] }

function computed(c: GoldenCase): PropagationResult {
  return c.name.startsWith('fspl_p526') ? computeFsplP526(c.input) : computeP2001Lite(c.input)
}

function expectClose(got: number, want: number, tol: number, what: string): void {
  expect(
    Math.abs(got - want),
    `${what}: ${got.toFixed(3)} vs ${want.toFixed(3)} дБ (допуск ${tol})`,
  ).toBeLessThanOrEqual(tol)
}

for (const c of doc.cases) {
  test(`golden ${c.name} — самопроверка TS-снапшота (±${doc.toleranceSnapshotDb} дБ)`, () => {
    const r = computed(c)
    expectClose(r.medianLossDb, c.ts.medianLossDb, doc.toleranceSnapshotDb, 'medianLossDb')
    expect(r.byTimePercent.length).toBe(c.ts.byTimePercent.length)
    for (let i = 0; i < r.byTimePercent.length; i++) {
      expect(r.byTimePercent[i]!.percent).toBe(c.ts.byTimePercent[i]!.percent)
      expectClose(
        r.byTimePercent[i]!.lossDb,
        c.ts.byTimePercent[i]!.lossDb,
        doc.toleranceSnapshotDb,
        `byTime p=${r.byTimePercent[i]!.percent}`,
      )
    }
    for (const key of Object.keys(c.ts.breakdown)) {
      const got = (r.breakdown as Record<string, number | undefined>)[key]
      expectClose(got ?? NaN, c.ts.breakdown[key]!, doc.toleranceSnapshotDb, `breakdown.${key}`)
    }
  })

  test(`golden ${c.name} — кросс-движок TS vs python (±${doc.toleranceCrossDb} дБ)`, () => {
    const r = computed(c)
    expectClose(r.medianLossDb, c.py.medianLossDb, doc.toleranceCrossDb, 'medianLossDb')
    expect(r.byTimePercent.length).toBe(c.py.byTimePercent.length)
    for (let i = 0; i < r.byTimePercent.length; i++) {
      expectClose(
        r.byTimePercent[i]!.lossDb,
        c.py.byTimePercent[i]!.lossDb,
        doc.toleranceCrossDb,
        `byTime p=${r.byTimePercent[i]!.percent}`,
      )
    }
  })
}
