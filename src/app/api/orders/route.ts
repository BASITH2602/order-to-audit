import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { submitOrder } from '@/lib/sales'

const Body = z.object({
  customerId: z.number().int().positive(),
  clientRef: z.string().min(8).max(64).optional(), // generated on the phone for safe offline retries
  lines: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().int().positive() })).min(1),
})

// Salesman: own orders only. Admin/Owner: all.
export const GET = route(['SALESMAN', 'FACTORY_ADMIN', 'OWNER', 'ACCOUNTANT'], async ({ session, req }) => {
  const status = new URL(req.url).searchParams.get('status')
  return prisma.order.findMany({
    where: { ...(session.role === 'SALESMAN' ? { salesmanId: session.userId } : {}), ...(status ? { status: status as never } : {}) },
    include: { customer: true, salesman: { select: { name: true } }, lines: { include: { product: true } }, invoice: true },
    orderBy: { id: 'desc' },
    take: 200,
  })
})

export const POST = route(['SALESMAN'], async ({ session, req }) => {
  const body = Body.parse(await req.json())
  return submitOrder({ ...body, salesmanId: session.userId })
})
