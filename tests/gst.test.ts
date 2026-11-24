import { describe, it, expect } from 'vitest'
import { computeGst, financialYear } from '../src/lib/gst'

describe('computeGst', () => {
  it('Retailer A: 150 x Rs 50 at 5% intra-state = 7500 + 187.50 + 187.50 = 7875', () => {
    const r = computeGst([{ taxablePaise: 150 * 5000, gstRatePct: 5 }], true)
    expect(r).toEqual({ taxablePaise: 750_000, cgstPaise: 18_750, sgstPaise: 18_750, igstPaise: 0, totalPaise: 787_500 })
  })

  it('inter-state uses IGST only', () => {
    const r = computeGst([{ taxablePaise: 88 * 5000, gstRatePct: 5 }], false)
    expect(r.igstPaise).toBe(22_000)
    expect(r.cgstPaise + r.sgstPaise).toBe(0)
    expect(r.totalPaise).toBe(462_000)
  })

  it('CGST always equals SGST (half-up per half)', () => {
    const r = computeGst([{ taxablePaise: 1_001, gstRatePct: 5 }], true) // tax 50.05 paise
    expect(r.cgstPaise).toBe(r.sgstPaise)
  })

  it('groups by rate across lines', () => {
    const r = computeGst(
      [
        { taxablePaise: 10_000, gstRatePct: 5 },
        { taxablePaise: 20_000, gstRatePct: 5 },
        { taxablePaise: 10_000, gstRatePct: 12 },
      ],
      false,
    )
    expect(r.igstPaise).toBe(1_500 + 1_200)
  })
})

describe('financialYear (IST, April start)', () => {
  it('Nov 2026 is FY 2026-27', () => expect(financialYear(new Date('2026-11-22T10:00:00Z'))).toBe('2026-27'))
  it('31 Mar 2027 daytime is still 2026-27', () => expect(financialYear(new Date('2027-03-31T06:00:00Z'))).toBe('2026-27'))
  it('01:30 IST on 1 Apr 2027 (20:00Z on 31 Mar) is 2027-28', () =>
    expect(financialYear(new Date('2027-03-31T20:00:00Z'))).toBe('2027-28'))
})
