/**
 * Pure maths: weighted-average valuation, variance %, rounding to paise.
 * No floats for money: everything runs on Decimal.
 */
import { Prisma } from '@prisma/client'

const D = Prisma.Decimal
export type Dec = Prisma.Decimal

export type Mv = { qtyDelta: number; unitCost: Dec | string | number }

/**
 * Moving weighted-average cost over an ordered list of ledger movements.
 * Receipts (qtyDelta > 0) re-average; issues (qtyDelta < 0) leave the average unchanged.
 * avgCost is paise per BASE unit.
 */
export function runningAverage(movs: Mv[]): { balance: number; avgCost: Dec } {
  let balance = 0
  let value = new D(0)
  let avg = new D(0)
  for (const m of movs) {
    if (m.qtyDelta > 0) {
      value = value.add(new D(m.unitCost).mul(m.qtyDelta))
      balance += m.qtyDelta
      avg = value.div(balance)
    } else {
      balance += m.qtyDelta
      value = avg.mul(balance)
    }
  }
  return { balance, avgCost: avg }
}

/** qty (base units) x unit cost (paise/base unit) -> whole paise, half-up. */
export function moneyPaise(qty: number, unitCost: Dec | string | number): number {
  return new D(unitCost).mul(qty).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber()
}

/** (actual - planned) / planned x 100, 2 dp. Null when planned is 0. */
export function variancePct(planned: number, actual: number): Dec | null {
  if (planned === 0) return null
  return new D(actual - planned).mul(100).div(planned).toDecimalPlaces(2)
}

/** Flag only when the absolute variance is strictly greater than the tolerance (whole %). */
export function isFlagged(pct: Dec | null, tolerancePct: number): boolean {
  return pct !== null && pct.abs().greaterThan(tolerancePct)
}
