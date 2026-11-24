import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

export const GET = route(['SALESMAN', 'FACTORY_ADMIN', 'PRODUCTION', 'OWNER', 'ACCOUNTANT'], () =>
  prisma.product.findMany({ include: { boms: { where: { active: true }, include: { lines: true } } }, orderBy: { id: 'asc' } }),
)
