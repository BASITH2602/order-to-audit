/** Shared validation for master-data routes (kept out of route files: Next.js route modules may only export HTTP handlers). */
import { z } from 'zod'
import { prisma } from './db'
import { isValidGstin, gstinState } from './gstin'
import { stateName } from './gst-states'
import { toBaseQty } from './units'

export const CustomerBody = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['RETAILER', 'DISTRIBUTOR']),
  stateCode: z.string().regex(/^\d{2}$/),
  gstin: z.string().trim().toUpperCase().optional().or(z.literal('')),
})

/** The GSTIN's first two digits must equal the state code, and the check character must be right. */
export function checkCustomer(b: z.infer<typeof CustomerBody>) {
  const sName = stateName(b.stateCode)
  if (!sName) throw new Error('Unknown state code')
  const gstin = b.gstin ? b.gstin : null
  if (gstin) {
    if (!isValidGstin(gstin)) throw new Error('GSTIN is not valid (check the number)')
    if (gstinState(gstin) !== b.stateCode) throw new Error('GSTIN state code does not match the selected state')
  }
  return { name: b.name, type: b.type, gstin, stateCode: b.stateCode, stateName: sName }
}

export const BomLines = z.array(z.object({ itemId: z.number().int().positive(), qty: z.string() })).min(1) // qty per batch, display unit

export async function toBaseLines(lines: z.infer<typeof BomLines>) {
  const ids = lines.map((l) => l.itemId)
  if (new Set(ids).size !== ids.length) throw new Error('An item appears twice in the recipe')
  const items = await prisma.item.findMany({ where: { id: { in: ids } } })
  const byId = new Map(items.map((i) => [i.id, i]))
  return lines.map((l) => {
    const it = byId.get(l.itemId)
    if (!it) throw new Error(`Unknown item ${l.itemId}`)
    if (it.kind === 'FINISHED') throw new Error('Finished goods cannot be recipe ingredients')
    const qtyPerBatch = toBaseQty(l.qty, it.displayFactor)
    if (qtyPerBatch <= 0) throw new Error(`Quantity for ${it.name} must be above zero`)
    return { itemId: it.id, qtyPerBatch }
  })
}
