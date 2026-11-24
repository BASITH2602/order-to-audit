import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { getValuation } from '@/lib/stock'
import { toDisplayQty } from '@/lib/units'

// Current balances, always derived from the ledger.
export const GET = route(['FACTORY_ADMIN', 'PRODUCTION', 'OWNER', 'ACCOUNTANT'], async () => {
  const items = await prisma.item.findMany({ orderBy: { id: 'asc' } })
  const sums = await prisma.stockMovement.groupBy({ by: ['itemId'], _sum: { qtyDelta: true } })
  const bal = new Map(sums.map((s) => [s.itemId, s._sum.qtyDelta ?? 0]))
  return Promise.all(
    items.map(async (i) => {
      const baseQty = bal.get(i.id) ?? 0
      const { avgCost } = await getValuation(i.id)
      return {
        itemId: i.id,
        sku: i.sku,
        name: i.name,
        kind: i.kind,
        baseQty,
        displayQty: toDisplayQty(baseQty, i.displayFactor),
        displayUnit: i.displayUnit,
        displayFactor: i.displayFactor,
        avgCostPaisePerBaseUnit: avgCost.toString(),
        low: i.reorderLevel !== null && baseQty <= i.reorderLevel,
      }
    }),
  )
})
