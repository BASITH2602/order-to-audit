import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  packLabel: z.string().trim().min(1).max(20), // "200 g", "500 g"
  hsn: z.string().regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits'),
  gstRatePct: z.number().int().min(0).max(28),
  pricePaise: z.number().int().nonnegative(),
  packetsPerCarton: z.number().int().positive(),
  // New pack size with the same recipe: copy another product's BOM (editable afterwards).
  copyBomFromProductId: z.number().int().positive().optional(),
})

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')

export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const b = Body.parse(await req.json())
  return prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: { sku: `FG-${slug(b.name)}-${slug(b.packLabel)}`, name: `${b.name} ${b.packLabel}`, kind: 'FINISHED', baseUnit: 'PCS', displayUnit: 'packets', displayFactor: 1 },
    })
    const product = await tx.product.create({
      data: { name: b.name, packLabel: b.packLabel, itemId: item.id, hsn: b.hsn, gstRatePct: b.gstRatePct, pricePaise: b.pricePaise, packetsPerCarton: b.packetsPerCarton },
    })
    if (b.copyBomFromProductId) {
      const src = await tx.bom.findFirstOrThrow({ where: { productId: b.copyBomFromProductId, active: true }, include: { lines: true } })
      await tx.bom.create({
        data: { productId: product.id, expectedYield: src.expectedYield, lines: { create: src.lines.map((l) => ({ itemId: l.itemId, qtyPerBatch: l.qtyPerBatch })) } },
      })
    }
    await tx.auditLog.create({ data: { entity: 'Product', entityId: String(product.id), action: 'CREATE', userId: session.userId, after: { ...b, itemId: item.id } as never } })
    return product
  })
})
