import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { CustomerBody, checkCustomer } from '@/lib/masters'

export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const data = checkCustomer(CustomerBody.parse(await req.json()))
  const c = await prisma.customer.create({ data })
  await prisma.auditLog.create({ data: { entity: 'Customer', entityId: String(c.id), action: 'CREATE', userId: session.userId, after: c as never } })
  return c
})
