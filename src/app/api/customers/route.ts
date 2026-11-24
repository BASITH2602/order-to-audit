import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

export const GET = route(['SALESMAN', 'FACTORY_ADMIN', 'OWNER', 'ACCOUNTANT'], () =>
  prisma.customer.findMany({ orderBy: { name: 'asc' } }),
)
