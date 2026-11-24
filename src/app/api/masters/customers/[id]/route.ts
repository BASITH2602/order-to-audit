import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { CustomerBody, checkCustomer } from '@/lib/masters'

// Existing invoices keep the state/GSTIN they were issued with, because the invoice stores its own tax split.
export const PATCH = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const data = checkCustomer(CustomerBody.parse(await req.json()))
  const id = Number(params.id)
  return prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({ where: { id } })
    const after = await tx.customer.update({ where: { id }, data })
    await tx.auditLog.create({ data: { entity: 'Customer', entityId: String(id), action: 'UPDATE', userId: session.userId, before: before as never, after: after as never } })
    return after
  })
})
