import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { BomLines, toBaseLines } from '@/lib/masters'

// Replace a recipe. Past production runs keep the planned quantities they were saved with.
export const PUT = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const b = z.object({ expectedYield: z.number().int().positive(), lines: BomLines }).parse(await req.json())
  const id = Number(params.id)
  const lines = await toBaseLines(b.lines)
  return prisma.$transaction(async (tx) => {
    const before = await tx.bom.findUniqueOrThrow({ where: { id }, include: { lines: true } })
    await tx.bomLine.deleteMany({ where: { bomId: id } })
    const after = await tx.bom.update({ where: { id }, data: { expectedYield: b.expectedYield, lines: { create: lines } }, include: { lines: true } })
    await tx.auditLog.create({ data: { entity: 'Bom', entityId: String(id), action: 'UPDATE', userId: session.userId, before: before as never, after: after as never } })
    return after
  })
})
