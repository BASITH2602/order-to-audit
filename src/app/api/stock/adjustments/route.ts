import { z } from 'zod'
import { Prisma, MovementType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { notify } from '@/lib/events'
import { getBalance, getValuation } from '@/lib/stock'
import { toBaseQty, unitCostFromRate } from '@/lib/units'

const Body = z.object({
  mode: z.enum(['OPENING', 'ADJUSTMENT']),
  itemId: z.number().int().positive(),
  qty: z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter a number such as 25 or -2.5'), // display units, negative only for ADJUSTMENT
  ratePaise: z.number().int().nonnegative().optional(), // per display unit; needed for opening stock and for adding stock with no history
  reason: z.string().trim().min(3),
})

/**
 * OPENING: first balance for an item with no stock history.
 * ADJUSTMENT: stock-take difference or correction. Removing stock cannot exceed the balance.
 * Both create a StockAdjustment document so every ledger row has a traceable source.
 */
export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const b = Body.parse(await req.json())
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUniqueOrThrow({ where: { id: b.itemId } })
    const negative = b.qty.startsWith('-')
    const base = toBaseQty(negative ? b.qty.slice(1) : b.qty, item.displayFactor)
    if (base === 0) throw new Error('Quantity cannot be zero')
    const delta = negative ? -base : base

    let unitCost: string
    if (b.mode === 'OPENING') {
      if (negative) throw new Error('Opening stock cannot be negative')
      if (b.ratePaise === undefined) throw new Error('Opening stock needs a rate')
      if ((await tx.stockMovement.count({ where: { itemId: item.id } })) > 0) throw new Error('This item already has stock history. Use an adjustment instead.')
      unitCost = unitCostFromRate(b.ratePaise, item.displayFactor)
    } else {
      const balance = await getBalance(item.id, tx)
      if (balance + delta < 0) throw new Error(`Adjustment would make stock negative (balance is ${balance} base units)`)
      const { avgCost } = await getValuation(item.id, tx)
      if (b.ratePaise !== undefined) unitCost = unitCostFromRate(b.ratePaise, item.displayFactor)
      else if (avgCost.greaterThan(0)) unitCost = avgCost.toString()
      else if (delta < 0) unitCost = '0'
      else throw new Error('Adding stock with no cost history needs a rate')
    }

    const doc = await tx.stockAdjustment.create({ data: { kind: b.mode, itemId: item.id, qtyDelta: delta, reason: b.reason, createdById: session.userId } })
    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        qtyDelta: delta,
        unitCost,
        type: b.mode === 'OPENING' ? MovementType.OPENING : MovementType.ADJUSTMENT,
        sourceType: b.mode,
        sourceId: String(doc.id),
        note: b.reason,
        createdById: session.userId,
      },
    })
    await tx.auditLog.create({ data: { entity: 'StockAdjustment', entityId: String(doc.id), action: 'CREATE', userId: session.userId, after: doc as never } })
    return doc
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  await notify('stock', { type: 'stock.changed', adjustmentId: result.id })
  return result
})
