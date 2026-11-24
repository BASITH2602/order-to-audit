import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { notify } from '@/lib/events'
import { postPurchase } from '@/lib/stock'
import { toBaseQty, unitCostFromRate } from '@/lib/units'

const Body = z.object({
  supplierId: z.number().int().positive(),
  billNo: z.string().min(1),
  date: z.coerce.date(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        qty: z.string(), // in the item's display unit, e.g. "60" kg
        ratePaise: z.number().int().nonnegative(), // per display unit, e.g. 4500 = Rs 45/kg
        batchNo: z.string().optional(),
        expiry: z.coerce.date().optional(),
      }),
    )
    .min(1),
})

export const POST = route(['PRODUCTION', 'FACTORY_ADMIN'], async ({ session, req }) => {
  const body = Body.parse(await req.json())
  const items = await prisma.item.findMany({ where: { id: { in: body.lines.map((l) => l.itemId) } } })
  const byId = new Map(items.map((i) => [i.id, i]))
  const purchase = await postPurchase({
    supplierId: body.supplierId,
    billNo: body.billNo,
    date: body.date,
    userId: session.userId,
    lines: body.lines.map((l) => {
      const item = byId.get(l.itemId)
      if (!item) throw new Error(`Unknown item ${l.itemId}`)
      if (item.kind === 'FINISHED') throw new Error('Finished goods cannot be purchased')
      return { itemId: l.itemId, qty: toBaseQty(l.qty, item.displayFactor), unitCost: unitCostFromRate(l.ratePaise, item.displayFactor), batchNo: l.batchNo, expiry: l.expiry }
    }),
  })
  await notify('stock', { type: 'stock.changed', purchaseId: purchase.id })
  return purchase
})
