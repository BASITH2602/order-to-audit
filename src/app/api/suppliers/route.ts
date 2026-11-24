import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

export const GET = route(['PRODUCTION', 'FACTORY_ADMIN', 'ACCOUNTANT'], () => prisma.supplier.findMany({ orderBy: { name: 'asc' } }))

export const POST = route(['PRODUCTION', 'FACTORY_ADMIN'], async ({ req }) => {
  const b = z.object({ name: z.string().min(2), gstin: z.string().optional() }).parse(await req.json())
  return prisma.supplier.create({ data: b })
})
