/**
 * Pure GST maths. All amounts are integer paise.
 * Rule: tax is computed per rate on the invoice-level taxable value (not per line),
 * rounded half-up to whole paise. Intra-state: CGST = SGST = half the rate, each rounded
 * half-up, so the two are always equal. Inter-state: full rate as IGST.
 */

/** Integer half-up division of n/d for non-negative n, positive d. */
function halfUp(n: number, d: number): number {
  return Math.floor((n * 2 + d) / (d * 2))
}

/** Financial year label ("2026-27") in IST, FY starting in `startMonth` (4 = April). */
export function financialYear(d: Date, startMonth = 4): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth() + 1
  const start = m >= startMonth ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export type GstLine = { taxablePaise: number; gstRatePct: number }

export function computeGst(lines: GstLine[], intraState: boolean) {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.gstRatePct, (byRate.get(l.gstRatePct) ?? 0) + l.taxablePaise)

  let taxable = 0
  let cgst = 0
  let sgst = 0
  let igst = 0
  for (const [rate, base] of byRate) {
    taxable += base
    if (intraState) {
      const half = halfUp(base * rate, 200)
      cgst += half
      sgst += half
    } else {
      igst += halfUp(base * rate, 100)
    }
  }
  return { taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: taxable + cgst + sgst + igst }
}
