import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { notify } from '@/lib/events'
import { postProductionRun } from '@/lib/stock'
import { toBaseQty } from '@/lib/units'

const Body = z.object({
  bomId: z.number().int().positive(),
  batches: z.number().int().positive().default(1),
  runDate: z.coerce.date(),
  actuals: z.array(z.object({ itemId: z.number().int().positive(), qty: z.string() })).min(1), // display units
  goodOutput: z.number().int().nonnegative(),
  damagedPackets: z.number().int().nonnegative().default(0),
  labourPaise: z.number().int().nonnegative().optional(),
  powerGasPaise: z.number().int().nonnegative().optional(),
  otherOverheadPaise: z.number().int().nonnegative().optional(),
})

export const GET = route(['PRODUCTION', 'FACTORY_ADMIN', 'OWNER', 'ACCOUNTANT'], () =>
  prisma.productionRun.findMany({ orderBy: { id: 'desc' }, take: 100, include: { bom: { include: { product: true } } } }),
)

export const POST = route(['PRODUCTION', 'FACTORY_ADMIN'], async ({ session, req }) => {
  const b = Body.parse(await req.json())
  const items = await prisma.item.findMany({ where: { id: { in: b.actuals.map((a) => a.itemId) } } })
  const byId = new Map(items.map((i) => [i.id, i]))
  const result = await postProductionRun({
    ...b,
    userId: session.userId,
    actuals: b.actuals.map((a) => {
      const item = byId.get(a.itemId)
      if (!item) throw new Error(`Unknown item ${a.itemId}`)
      return { itemId: a.itemId, actualQty: toBaseQty(a.qty, item.displayFactor) }
    }),
  })
  await notify('stock', { type: 'stock.changed', runId: result.runId })
  if (result.yield.flagged || result.lines.some((l) => l.flagged)) {
    await notify('alerts', { type: 'variance.flagged', runId: result.runId, runNo: result.runNo })
  }
  return result
})
