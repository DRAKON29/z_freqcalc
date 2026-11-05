/**
 * Дифракция на препятствиях — ITU-R P.526:
 *  • одиночное ножевое ребро (§4.2, параметр v);
 *  • метод Буллингтона (§4.5.2);
 *  • метод Дейгаута с выбором доминирующего ребра (§4.4);
 * По ТЗ 4.2.2 берётся наибольшая из оценок Дейгаута и Буллингтона.
 */
import { earthBulgeM } from './fspl'

export interface Edge {
  d: number // расстояние от Tx, м
  h: number // абсолютная высота вершины, м
}

/**
 * Параметр v одиночного ребра (P.526 §4.2.1):
 *   v = h·√2 / √(λ·d1·d2/(d1+d2))
 */
export function knifeEdgeV(d1: number, d2: number, hAboveLos: number, freqMhz: number): number {
  const lambda = 299.792458 / freqMhz // м
  if (d1 <= 0 || d2 <= 0) return 0
  const denom = Math.sqrt((lambda * d1 * d2) / (d1 + d2))
  if (denom <= 0) return 0
  return (hAboveLos * Math.SQRT2) / denom
}

/** Потери на одиночном ножевом ребре J(v), дБ (P.526 §4.2.2). */
export function knifeEdgeLossDb(v: number): number {
  if (v <= -0.78) return 0
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)
}

/**
 * Метод Буллингтона (P.526 §4.5.2): виртуальное ребро на пересечении
 * касательных от Tx и Rx к препятствиям.
 * edges — вершины между Tx (d=0) и Rx (d=dTotal).
 */
export function bullingtonLossDb(
  edges: Edge[],
  txH: number,
  rxH: number,
  dTotal: number,
  freqMhz: number,
  kFactor: number,
): number {
  if (edges.length === 0) return 0

  let sT = -Infinity
  let sR = -Infinity
  for (const e of edges) {
    if (e.d <= 0 || e.d >= dTotal) continue
    const hEff = e.h + earthBulgeM(e.d, dTotal, kFactor)
    const slopeTx = (hEff - txH) / e.d
    const slopeRx = (hEff - rxH) / (e.d - dTotal)
    if (slopeTx > sT) sT = slopeTx
    if (slopeRx > sR) sR = slopeRx
  }
  if (!isFinite(sT) || !isFinite(sR)) return 0

  // Точка пересечения касательных
  const dCross = (rxH - sR * dTotal - txH) / (sT - sR)
  if (dCross <= 0 || dCross >= dTotal) return 0
  const hCross = txH + sT * dCross
  const hLos = txH + ((rxH - txH) * dCross) / dTotal
  const hAbove = hCross - hLos
  if (hAbove <= 0) return 0

  const v = knifeEdgeV(dCross, dTotal - dCross, hAbove, freqMhz)
  return knifeEdgeLossDb(v)
}

/**
 * Метод Дейгаута (P.526 §4.4): доминирующее ребро + рекурсивно вложенные
 * слева и справа. edges — вершины между Tx и Rx; dTotal — длина подпутей
 * от соответствующей опорной точки.
 */
export function deygoutLossDb(
  edges: Edge[],
  txH: number,
  rxH: number,
  dTotal: number,
  freqMhz: number,
  kFactor: number,
): number {
  if (edges.length === 0) return 0
  const losHeight = (d: number) => txH + ((rxH - txH) * d) / dTotal
  const effHeight = (e: Edge) => e.h + earthBulgeM(e.d, dTotal, kFactor)

  let worst: Edge | null = null
  let worstV = -Infinity
  for (const e of edges) {
    if (e.d <= 0 || e.d >= dTotal) continue
    const v = knifeEdgeV(e.d, dTotal - e.d, effHeight(e) - losHeight(e.d), freqMhz)
    if (v > worstV) {
      worstV = v
      worst = e
    }
  }
  if (!worst || worstV <= 0) return 0

  let loss = knifeEdgeLossDb(worstV)
  const hMain = effHeight(worst)

  const left = edges.filter((e) => e.d < worst!.d)
  const right = edges.filter((e) => e.d > worst!.d)
  if (left.length > 0) {
    loss += deygoutLossDb(left, txH, hMain, worst.d, freqMhz, kFactor)
  }
  if (right.length > 0) {
    // Пересчёт координат относительно ребра-доминанты
    const rebased = right.map((e) => ({ d: e.d - worst!.d, h: e.h }))
    loss += deygoutLossDb(rebased, hMain, rxH, dTotal - worst.d, freqMhz, kFactor)
  }
  return loss
}

/** Выбор локальных максимумов профиля (вершины препятствий). */
export function extractEdges(profile: { d: number; elev: number }[]): Edge[] {
  const edges: Edge[] = []
  for (let i = 1; i < profile.length - 1; i++) {
    const prev = profile[i - 1]
    const cur = profile[i]
    const next = profile[i + 1]
    if (cur.elev >= prev.elev && cur.elev >= next.elev) {
      edges.push({ d: cur.d, h: cur.elev })
    }
  }
  if (edges.length === 0 && profile.length >= 3) {
    let maxIdx = 1
    for (let i = 1; i < profile.length - 1; i++) {
      if (profile[i].elev > profile[maxIdx].elev) maxIdx = i
    }
    edges.push({ d: profile[maxIdx].d, h: profile[maxIdx].elev })
  }
  return edges
}

/**
 * Комбинированная оценка дифракции по ТЗ 4.2.2: наибольшая из оценок
 * Дейгаута и Буллингтона. clutterHeights — вершины зданий/растительности.
 */
export function diffractionLossDb(
  profile: { d: number; elev: number }[],
  txH: number,
  rxH: number,
  freqMhz: number,
  kFactor: number,
  clutterHeights: Edge[] = [],
): number {
  if (profile.length < 3) return 0
  const dTotal = profile[profile.length - 1].d
  const edges = [...extractEdges(profile), ...clutterHeights].sort((a, b) => a.d - b.d)
  if (edges.length === 0) return 0

  const deygout = deygoutLossDb(edges, txH, rxH, dTotal, freqMhz, kFactor)
  const bull = bullingtonLossDb(edges, txH, rxH, dTotal, freqMhz, kFactor)
  return Math.max(deygout, bull)
}
