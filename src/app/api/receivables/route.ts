import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { getOutstanding } from '@/lib/sales'

export const GET = route(['FACTORY_ADMIN', 'ACCOUNTANT', 'OWNER'], async () => {
  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } })
  const rows = await Promise.all(customers.map(async (c) => ({ customerId: c.id, name: c.name, outstandingPaise: await getOutstanding(c.id) })))
  return rows.filter((r) => r.outstandingPaise !== 0)
})
