import { z } from 'zod'
import { route } from '@/lib/api'
import { HttpError } from '@/lib/errors'
import { approveOrder, rejectOrder, issueInvoice, checkOrderStock } from '@/lib/sales'

const Edits = z.object({
  edits: z.array(z.object({ lineId: z.number().int(), qty: z.number().int().positive().optional(), pricePaise: z.number().int().nonnegative().optional() })).optional(),
})

// GET  /api/orders/:id/stock-check
export const GET = route(['FACTORY_ADMIN'], async ({ params }) => {
  if (params.action !== 'stock-check') throw new HttpError(404, 'Not found')
  return checkOrderStock(Number(params.id))
})

// POST /api/orders/:id/(approve|reject|invoice)
export const POST = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const id = Number(params.id)
  switch (params.action) {
    case 'approve': {
      const body = Edits.parse(await req.json().catch(() => ({})))
      return approveOrder(id, session.userId, body.edits)
    }
    case 'reject': {
      const { reason } = z.object({ reason: z.string().min(3) }).parse(await req.json())
      return rejectOrder(id, session.userId, reason)
    }
    case 'invoice':
      return issueInvoice(id, session.userId)
    default:
      throw new HttpError(404, 'Not found')
  }
})
