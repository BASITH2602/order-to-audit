import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { BomLines, toBaseLines } from '@/lib/masters'

// Create the first recipe (BOM) for a product.
export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const b = z.object({ productId: z.number().int().positive(), expectedYield: z.number().int().positive(), lines: BomLines }).parse(await req.json())
  const lines = await toBaseLines(b.lines)
  if (await prisma.bom.findFirst({ where: { productId: b.productId, active: true } })) throw new Error('This product already has a recipe. Edit it instead.')
  const bom = await prisma.bom.create({ data: { productId: b.productId, expectedYield: b.expectedYield, lines: { create: lines } }, include: { lines: true } })
  await prisma.auditLog.create({ data: { entity: 'Bom', entityId: String(bom.id), action: 'CREATE', userId: session.userId, after: bom as never } })
  return bom
})
