import { describe, it, expect } from 'vitest'
import { isValidGstin, gstinCheckChar } from '../src/lib/gstin'

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN with correct check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true)
  })
  it('rejects a wrong check character, bad shape and wrong length', () => {
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false)
    expect(isValidGstin('27AAPFU0939F2ZV')).toBe(false)
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false)
    expect(isValidGstin('')).toBe(false)
  })
  it('computes the check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V')
  })
})
