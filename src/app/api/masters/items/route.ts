import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { toBaseQty } from '@/lib/units'

// Unit presets: what people say -> how it is stored (base unit + display factor).
const UNITS = {
  kg: { baseUnit: 'G', displayUnit: 'kg', displayFactor: 1000 },
  g: { baseUnit: 'G', displayUnit: 'g', displayFactor: 1 },
  L: { baseUnit: 'ML', displayUnit: 'L', displayFactor: 1000 },
  ml: { baseUnit: 'ML', displayUnit: 'ml', displayFactor: 1 },
  pcs: { baseUnit: 'PCS', displayUnit: 'pcs', displayFactor: 1 },
} as const

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['RAW', 'PACKAGING']),
  unit: z.enum(['kg', 'g', 'L', 'ml', 'pcs']),
  reorderLevel: z.string().optional(), // display units
})

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')

export const GET = route(['FACTORY_ADMIN', 'PRODUCTION'], () => prisma.item.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }))

export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const b = Body.parse(await req.json())
  const u = UNITS[b.unit]
  const item = await prisma.item.create({
    data: {
      sku: `${b.kind === 'RAW' ? 'RM' : 'PK'}-${slug(b.name)}`,
      name: b.name,
      kind: b.kind,
      ...u,
      reorderLevel: b.reorderLevel ? toBaseQty(b.reorderLevel, u.displayFactor) : null,
    },
  })
  await prisma.auditLog.create({ data: { entity: 'Item', entityId: String(item.id), action: 'CREATE', userId: session.userId, after: item as never } })
  return item
})
