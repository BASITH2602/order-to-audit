import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

const Body = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  hsn: z.string().regex(/^\d{4,8}$/).optional(),
  gstRatePct: z.number().int().min(0).max(28).optional(),
  pricePaise: z.number().int().nonnegative().optional(), // new list price; existing invoices keep their own price
  packetsPerCarton: z.number().int().positive().optional(),
})

export const PATCH = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const data = Body.parse(await req.json())
  const id = Number(params.id)
  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUniqueOrThrow({ where: { id } })
    const after = await tx.product.update({ where: { id }, data })
    await tx.auditLog.create({ data: { entity: 'Product', entityId: String(id), action: 'UPDATE', userId: session.userId, before: before as never, after: after as never } })
    return after
  })
})
