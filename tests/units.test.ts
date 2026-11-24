import { describe, it, expect } from 'vitest'
import { toBaseQty, toDisplayQty, unitCostFromRate } from '../src/lib/units'

describe('unit conversion', () => {
  it('kg and litres to base units', () => {
    expect(toBaseQty('40', 1000)).toBe(40_000)
    expect(toBaseQty('10.5', 1000)).toBe(10_500)
    expect(toBaseQty('1.2', 1000)).toBe(1_200)
  })
  it('pieces stay whole', () => {
    expect(toBaseQty('194', 1)).toBe(194)
    expect(() => toBaseQty('0.5', 1)).toThrow()
  })
  it('rejects precision finer than a base unit instead of rounding', () => {
    expect(() => toBaseQty('0.0005', 1000)).toThrow()
    expect(() => toBaseQty('abc', 1000)).toThrow()
    expect(() => toBaseQty('-1', 1000)).toThrow()
  })
  it('display quantity round-trips', () => {
    expect(toDisplayQty(19_500, 1000)).toBe('19.5')
    expect(toDisplayQty(120_000, 1000)).toBe('120')
  })
  it('Rs 45/kg is exactly 4.5 paise per gram; Rs 140/L is 14 paise per ml', () => {
    expect(unitCostFromRate(4500, 1000)).toBe('4.5')
    expect(unitCostFromRate(14000, 1000)).toBe('14')
    expect(unitCostFromRate(250, 1)).toBe('250')
  })
})
