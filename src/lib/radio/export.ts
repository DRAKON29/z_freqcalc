/** Экспорт результатов в JSON и CSV (ТЗ 4.9). */
import type { CalculationInput, DynamicsResult, HistoryEntry, LinkBudget, PropagationResult } from './types'

export function buildExportPayload(
  input: CalculationInput,
  prop: PropagationResult,
  budget: LinkBudget,
  dynamics?: DynamicsResult,
) {
  return {
    generatedAt: new Date().toISOString(),
    input: {
      frequencyMhz: input.frequencyMhz,
      polarization: input.polarization,
      points: input.path.points,
      distanceKm: +(input.path.distanceM / 1000).toFixed(3),
      demSource: input.path.demSource,
      demStepM: input.path.demStepM,
      txHeightM: input.txHeightM,
      rxHeightM: input.rxHeightM,
      kFactor: input.kFactor,
      climateZone: input.climateZone,
      atmosphere: input.atmosphere,
      profile: input.path.profile.map((p) => ({ d: +p.d.toFixed(1), elev: p.elev, clutter: p.clutter })),
    },
    propagation: prop,
    budget,
    dynamics,
  }
}

export function toJson(payload: object): string {
  return JSON.stringify(payload, null, 2)
}

export function toCsv(payload: { input: { profile: { d: number; elev: number; clutter: number }[] }; propagation: PropagationResult; budget: LinkBudget }): string {
  const rows: string[][] = []
  rows.push(['Секция', 'Параметр', 'Значение'])
  rows.push(['Вход', 'Частота, МГц', String(payload.input.frequencyMhz)])
  rows.push(['Вход', 'Расстояние, км', String(payload.input.distanceKm)])
  rows.push(['Потери', 'Медианные потери, дБ', payload.propagation.medianLossDb.toFixed(2)])
  for (const t of payload.propagation.byTimePercent) {
    rows.push(['Потери', `Потери для ${t.percent}% времени, дБ`, t.lossDb.toFixed(2)])
  }
  const b = payload.budget
  rows.push(['Бюджет', 'EIRP, дБм', b.eirpDbm.toFixed(2)])
  rows.push(['Бюджет', 'P_rx, дБм', b.prxDbm.toFixed(2)])
  rows.push(['Бюджет', 'SNR, дБ', b.snrDb.toFixed(2)])
  rows.push(['Бюджет', 'Link margin, дБ', b.linkMarginDb.toFixed(2)])
  for (const p of payload.input.profile) {
    rows.push(['Профиль', `d=${p.d.toFixed(0)} м`, `elev=${p.elev.toFixed(1)}`, `clutter=${p.clutter.toFixed(1)}`])
  }
  return rows
    .map((r) => r.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';'))
    .join('\n')
}

export function historyToCsv(entries: HistoryEntry[]): string {
  const rows = [['Дата', 'Название', 'Модель', 'Движок', 'Частота, МГц', 'Длина, км', 'Потери, дБ', 'Запас, дБ']]
  for (const e of entries) {
    rows.push([
      e.createdAt,
      e.name,
      e.model,
      e.engineUsed,
      String(e.frequencyMhz),
      e.distanceKm.toFixed(2),
      e.medianLossDb.toFixed(2),
      e.linkMarginDb.toFixed(2),
    ])
  }
  return rows.map((r) => r.map((c) => (/[",;\n]/.test(c) ? `"${c}"` : c)).join(';')).join('\n')
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
