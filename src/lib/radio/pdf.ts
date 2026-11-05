/**
 * Выгрузка истории расчётов в PDF.
 * Каждый лист — один расчёт: основные данные (частота, координаты приёмника
 * и передатчика, длина трассы), профиль рельефа с основными линиями
 * (рельеф, прямая видимость, зона Френеля) и данные по радиосвязи
 * (бюджет линии: EIRP, потери, P_rx, SNR, запас).
 *
 * Шрифт DejaVuSans (кириллица) подгружается из /public/fonts и встраивается в PDF.
 */
import { jsPDF } from 'jspdf'
import type { HistoryEntry, ProfilePoint } from './types'
import { earthBulgeM } from './fspl'
import { fresnelRadiusM } from './fresnel'

let fontsPromise: Promise<{ normal: string; bold: string }> | null = null

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(bin)
}

async function loadFonts(): Promise<{ normal: string; bold: string }> {
  const [n, b] = await Promise.all([
    fetch('/fonts/DejaVuSans.ttf').then((r) => {
      if (!r.ok) throw new Error('DejaVuSans.ttf недоступен')
      return r.arrayBuffer()
    }),
    fetch('/fonts/DejaVuSans-Bold.ttf').then((r) => {
      if (!r.ok) throw new Error('DejaVuSans-Bold.ttf недоступен')
      return r.arrayBuffer()
    }),
  ])
  return { normal: toBase64(n), bold: toBase64(b) }
}

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 14
const CONTENT_W = PAGE_W - 2 * MARGIN

/** Данные профиля в системе с вычтенной кривизной Земли (как на графике результатов). */
function preparedProfile(input: HistoryEntry['input']): {
  pts: Array<{ dKm: number; terrain: number; los: number; fresnel: number }>
  dTotal: number
} {
  const profile: ProfilePoint[] = input.path.profile
  const dTotal = input.path.distanceM
  const k = input.kFactor
  const txBase = profile[0]?.elev ?? 0
  const rxBase = profile[profile.length - 1]?.elev ?? 0
  const txAnt = txBase + input.txHeightM
  const rxAnt = rxBase + input.rxHeightM
  // Прореживание: максимум ~200 точек
  const step = Math.max(1, Math.ceil(profile.length / 200))
  const pts: Array<{ dKm: number; terrain: number; los: number; fresnel: number }> = []
  for (let i = 0; i < profile.length; i += step) {
    const p = profile[i]
    const bulge = earthBulgeM(p.d, dTotal, k)
    const relElev = p.elev - bulge
    const los = txAnt + ((rxAnt - txAnt) * p.d) / dTotal
    const f1 = fresnelRadiusM(p.d, dTotal, input.frequencyMhz)
    pts.push({ dKm: p.d / 1000, terrain: relElev, los, fresnel: los + f1 })
  }
  const last = profile[profile.length - 1]
  if (last && (profile.length - 1) % step !== 0) {
    const bulge = earthBulgeM(last.d, dTotal, k)
    const los = txAnt + ((rxAnt - txAnt) * last.d) / dTotal
    const f1 = fresnelRadiusM(last.d, dTotal, input.frequencyMhz)
    pts.push({ dKm: last.d / 1000, terrain: last.elev - bulge, los, fresnel: los + f1 })
  }
  return { pts, dTotal }
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Таблица «параметр — значение» в две колонки. */
function renderKeyValueGrid(
  doc: jsPDF,
  rows: Array<[string, string]>,
  x: number,
  y: number,
  opts: { colWidth?: number; rowH?: number; fontSize?: number } = {},
): number {
  const colW = opts.colWidth ?? CONTENT_W / 2
  const rowH = opts.rowH ?? 5.4
  const fs = opts.fontSize ?? 9
  doc.setFontSize(fs)
  let yy = y
  rows.forEach(([k, v], i) => {
    const col = i % 2
    const xx = x + col * colW
    const rowY = y + Math.floor(i / 2) * rowH
    yy = rowY + rowH
    doc.setFont('DejaVuSans', 'normal')
    doc.setTextColor(90, 90, 90)
    doc.text(k, xx, rowY + 3.8)
    doc.setFont('DejaVuSans', 'bold')
    doc.setTextColor(30, 30, 30)
    doc.text(v, xx + colW * 0.52, rowY + 3.8)
  })
  doc.setFont('DejaVuSans', 'normal')
  doc.setTextColor(30, 30, 30)
  return yy
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFont('DejaVuSans', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 118, 110)
  doc.text(text, MARGIN, y)
  doc.setDrawColor(15, 118, 110)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y + 1.4, PAGE_W - MARGIN, y + 1.4)
  doc.setFont('DejaVuSans', 'normal')
  doc.setTextColor(30, 30, 30)
  return y + 5
}

/** График профиля рельефа с основными линиями. */
function renderProfileChart(doc: jsPDF, entry: HistoryEntry, x: number, y: number, w: number, h: number): void {
  const { pts, dTotal } = preparedProfile(entry.input)
  if (pts.length < 2) return

  const dKmTotal = dTotal / 1000
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of pts) {
    yMin = Math.min(yMin, p.terrain)
    yMax = Math.max(yMax, p.terrain, p.los, p.fresnel)
  }
  const pad = Math.max(20, (yMax - yMin) * 0.15)
  yMin -= pad
  yMax += pad
  if (yMax - yMin < 50) yMax = yMin + 50

  const sx = (dKm: number) => x + (dKm / dKmTotal) * w
  const sy = (hM: number) => y + h - ((hM - yMin) / (yMax - yMin)) * h

  // Рамка и сетка
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.2)
  doc.rect(x, y, w, h)
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  for (let i = 0; i <= 4; i++) {
    const hh = yMin + ((yMax - yMin) * i) / 4
    const yy = sy(hh)
    doc.setDrawColor(225, 225, 225)
    doc.line(x, yy, x + w, yy)
    doc.text(fmt(hh, 0), x - 1.5, yy + 1, { align: 'right' })
  }
  for (let i = 0; i <= 5; i++) {
    const dd = (dKmTotal * i) / 5
    doc.text(fmt(dd, dKmTotal < 10 ? 1 : 0), sx(dd), y + h + 3.2, { align: 'center' })
  }
  doc.setTextColor(90, 90, 90)
  doc.text('км', x + w / 2, y + h + 7)
  doc.text('м', x - 9.5, y + 3)

  // Заливка рельефа
  const baseY = sy(yMin)
  const fillDeltas: Array<[number, number]> = []
  pts.forEach((p, i) => {
    const px = sx(p.dKm)
    const py = sy(Math.max(p.terrain, yMin))
    if (i === 0) fillDeltas.push([px - x, py - baseY])
    else {
      const prevX = sx(pts[i - 1].dKm)
      const prevY = sy(Math.max(pts[i - 1].terrain, yMin))
      fillDeltas.push([px - prevX, py - prevY])
    }
  })
  // замыкание в правый нижний угол
  fillDeltas.push([x + w - sx(pts[pts.length - 1].dKm), baseY - sy(Math.max(pts[pts.length - 1].terrain, yMin))])
  doc.setFillColor(200, 196, 190)
  try {
    doc.lines(fillDeltas, x, baseY, [1, 1], 'F', true)
  } catch {
    // заливка не критична
  }

  // Линия рельефа
  doc.setDrawColor(87, 83, 78)
  doc.setLineWidth(0.4)
  for (let i = 1; i < pts.length; i++) {
    doc.line(sx(pts[i - 1].dKm), sy(pts[i - 1].terrain), sx(pts[i].dKm), sy(pts[i].terrain))
  }

  // Зона Френеля F1 (пунктир)
  doc.setDrawColor(8, 145, 178)
  doc.setLineWidth(0.25)
  doc.setLineDashPattern([1, 1], 0)
  for (let i = 1; i < pts.length; i++) {
    doc.line(sx(pts[i - 1].dKm), sy(pts[i - 1].fresnel), sx(pts[i].dKm), sy(pts[i].fresnel))
  }
  doc.setLineDashPattern([], 0)

  // Прямая видимость (LOS)
  doc.setDrawColor(220, 38, 38)
  doc.setLineWidth(0.5)
  doc.line(sx(pts[0].dKm), sy(pts[0].los), sx(pts[pts.length - 1].dKm), sy(pts[pts.length - 1].los))

  // Легенда
  const ly = y + h + 11
  doc.setFontSize(7.5)
  doc.setDrawColor(87, 83, 78)
  doc.setLineWidth(0.6)
  doc.line(x, ly - 0.8, x + 6, ly - 0.8)
  doc.setTextColor(60, 60, 60)
  doc.text('Рельеф', x + 8, ly)
  doc.setDrawColor(220, 38, 38)
  doc.line(x + 26, ly - 0.8, x + 32, ly - 0.8)
  doc.text('Прямая видимость (LOS)', x + 34, ly)
  doc.setDrawColor(8, 145, 178)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(x + 78, ly - 0.8, x + 84, ly - 0.8)
  doc.setLineDashPattern([], 0)
  doc.text('Зона Френеля F1', x + 86, ly)
  doc.setTextColor(30, 30, 30)
}

function renderEntry(doc: jsPDF, e: HistoryEntry, pageNo: number, total: number): void {
  // Заголовок
  doc.setFont('DejaVuSans', 'bold')
  doc.setFontSize(13)
  doc.text(e.name || 'Расчёт', MARGIN, 16)
  doc.setFont('DejaVuSans', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110, 110, 110)
  const date = new Date(e.createdAt).toLocaleString('ru-RU')
  doc.text(`${date} · Движок: ${e.engineUsed}`, MARGIN, 21.5)
  doc.setTextColor(30, 30, 30)

  // Основные данные расчёта
  let y = sectionTitle(doc, 'Основные данные расчёта', 28)
  const a = e.input.path.points[0]
  const b = e.input.path.points[1]
  y = renderKeyValueGrid(doc, [
    ['Частота', `${fmt(e.input.frequencyMhz, 1)} МГц`],
    ['Поляризация', e.input.polarization === 'vertical' ? 'вертикальная' : e.input.polarization === 'horizontal' ? 'горизонтальная' : 'круговая'],
    ['Координаты передатчика (A)', `${a.lat.toFixed(5)}°, ${a.lon.toFixed(5)}°`],
    ['Координаты приёмника (Б)', `${b.lat.toFixed(5)}°, ${b.lon.toFixed(5)}°`],
    ['Длина трассы', `${fmt(e.distanceKm, 2)} км`],
    ['Азимут трассы (A→Б)', `${fmt(e.input.path.azimuthDeg, 1)}°`],
    ['Высота антенны Tx', `${fmt(e.input.txHeightM, 1)} м`],
    ['Высота антенны Rx', `${fmt(e.input.rxHeightM, 1)} м`],
    ['Фактор рефракции k', fmt(e.input.kFactor, 2)],
    ['Источник рельефа', e.input.path.demSource],
  ], MARGIN, y)

  // Профиль рельефа
  y += 4
  y = sectionTitle(doc, 'Рельеф трассы и основные линии', y)
  renderProfileChart(doc, e, MARGIN + 12, y, CONTENT_W - 14, 72)
  y += 72 + 15

  // Данные по радиосвязи
  y = sectionTitle(doc, 'Данные по радиосвязи (бюджет линии)', y)
  const budget = e.budget
  y = renderKeyValueGrid(doc, [
    ['ЭИИМ (EIRP)', `${fmt(budget.eirpDbm, 1)} дБм`],
    ['Потери на трассе', `${fmt(budget.pathLossDb, 1)} дБ`],
    ['Мощность на приёме (P_rx)', `${fmt(budget.prxDbm, 1)} дБм`],
    ['Мощность шума (N)', `${fmt(budget.noisePowerDbm, 1)} дБм`],
    ['Отношение сигнал/шум (SNR)', `${fmt(budget.snrDb, 1)} дБ`],
    ['Требуемое Eb/N0', `${fmt(budget.ebN0RequiredDb, 1)} дБ`],
  ], MARGIN, y)

  // Запас — выделенная строка
  y += 2
  const marginOk = budget.linkMarginDb >= 0
  doc.setFillColor(marginOk ? 236 : 254, marginOk ? 253 : 226, marginOk ? 245 : 226)
  doc.setDrawColor(marginOk ? 16 : 220, marginOk ? 185 : 38, marginOk ? 129 : 38)
  doc.roundedRect(MARGIN, y, CONTENT_W, 10, 1.5, 1.5, 'FD')
  doc.setFont('DejaVuSans', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(marginOk ? 21 : 185, marginOk ? 128 : 38, marginOk ? 61 : 38)
  doc.text(
    `Запас на линию (link margin): ${fmt(budget.linkMarginDb, 1)} дБ — ${marginOk ? 'связь обеспечена' : 'связь не обеспечена'}`,
    MARGIN + 4,
    y + 6.6,
  )
  doc.setTextColor(30, 30, 30)
  doc.setFont('DejaVuSans', 'normal')

  // Колонтитул
  doc.setFontSize(8)
  doc.setTextColor(140, 140, 140)
  doc.text(`Калькулятор распространения радиоволн · страница ${pageNo} из ${total}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' })
  doc.setTextColor(30, 30, 30)
}

/** Сборка PDF по списку записей истории. */
export async function historyEntriesToPdfBlob(entries: HistoryEntry[]): Promise<Blob> {
  fontsPromise ??= loadFonts()
  const fonts = await fontsPromise
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.addFileToVFS('DejaVuSans.ttf', fonts.normal)
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal')
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold)
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold')

  const total = Math.max(1, entries.length)
  entries.forEach((e, i) => {
    if (i > 0) doc.addPage()
    renderEntry(doc, e, i + 1, total)
  })
  return doc.output('blob')
}
