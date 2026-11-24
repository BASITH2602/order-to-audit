import { describe, it, expect } from 'vitest'
import { parseRange } from '../src/lib/reports'
import { moneyStr } from '../src/lib/report-catalog'
import { toCsv } from '../src/lib/report-export'

describe('parseRange (IST days, inclusive)', () => {
  it('covers both end dates in IST', () => {
    const r = parseRange('2026-11-01', '2026-11-30')
    expect(r.from.toISOString()).toBe('2026-10-31T18:30:00.000Z')
    expect(r.to.toISOString()).toBe('2026-11-30T18:30:00.000Z') // exclusive: midnight IST on 1 Dec
  })
  it('defaults to the current month in IST', () => {
    const r = parseRange(undefined, undefined, new Date('2026-11-23T10:00:00Z'))
    expect([r.fromStr, r.toStr]).toEqual(['2026-11-01', '2026-11-23'])
  })
  it('uses the IST month when UTC is still the previous day', () => {
    const r = parseRange(undefined, undefined, new Date('2026-11-30T20:00:00Z')) // 1 Dec 01:30 IST
    expect(r.fromStr).toBe('2026-12-01')
  })
  it('rejects bad dates and reversed ranges', () => {
    expect(() => parseRange('2026-02-30', '2026-03-01')).toThrow()
    expect(() => parseRange('26-1-1', '2026-03-01')).toThrow()
    expect(() => parseRange('2026-12-01', '2026-11-01')).toThrow()
  })
})

describe('money formatting', () => {
  it('is exact for integer paise', () => {
    expect(moneyStr(787_500)).toBe('7875.00')
    expect(moneyStr(787_500, true)).toBe('7,875.00')
    expect(moneyStr(-5)).toBe('-0.05')
    expect(moneyStr(123_456_789, true)).toBe('12,34,567.89')
  })
})

describe('CSV export', () => {
  const rep = {
    name: 't', title: 't', subtitle: '',
    columns: [{ key: 'a', label: 'Name', kind: 'text' as const }, { key: 'b', label: 'Amount', kind: 'money' as const }],
    rows: [{ a: '=HYPERLINK("x")', b: -250 }, { a: 'Smith, J', b: 787_500 }],
  }
  it('neutralises formulas, quotes commas, writes money exactly', () => {
    const csv = toCsv(rep)
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-2.50`)
    expect(csv).toContain('"Smith, J",7875.00')
    expect(csv.startsWith('\uFEFF')).toBe(true)
  })
})
