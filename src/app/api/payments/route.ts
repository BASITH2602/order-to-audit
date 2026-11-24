import { z } from 'zod'
import { route } from '@/lib/api'
import { recordPayment } from '@/lib/sales'

const Body = z.object({
  customerId: z.number().int().positive(),
  invoiceId: z.number().int().positive().optional(),
  amountPaise: z.number().int().positive(),
  mode: z.enum(['CASH', 'UPI', 'BANK', 'CHEQUE']),
})

export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) =>
  recordPayment({ ...Body.parse(await req.json()), userId: session.userId }),
)
