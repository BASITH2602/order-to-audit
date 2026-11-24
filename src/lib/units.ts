/**
 * Unit conversion between what people type (kg, L, pcs) and what the ledger stores (g, ml, pcs).
 * Every Item has displayFactor = base units per display unit (kg = 1000, L = 1000, pcs = 1).
 */
import { Prisma } from '@prisma/client'

const D = Prisma.Decimal

/** "10.5" litres -> 10500 ml. Rejects input finer than one base unit instead of silently rounding. */
export function toBaseQty(display: string, factor: number): number {
  if (!/^\d+(\.\d+)?$/.test(display)) throw new Error(`Invalid quantity "${display}"`)
  const base = new D(display).mul(factor)
  if (!base.isInteger()) throw new Error(`Quantity ${display} is finer than the smallest stock unit`)
  return base.toNumber()
}

export function toDisplayQty(base: number, factor: number): string {
  return new D(base).div(factor).toString()
}

/** Rate per display unit in paise (Rs 45/kg = 4500) -> paise per base unit as an exact decimal string ("4.5"). */
export function unitCostFromRate(ratePerDisplayUnitPaise: number, factor: number): string {
  return new D(ratePerDisplayUnitPaise).div(factor).toString()
}
