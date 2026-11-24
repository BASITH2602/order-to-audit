import { z } from 'zod'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'
import { HttpError } from '@/lib/errors'
import { dispatchInvoice, cancelInvoice } from '@/lib/sales'
import { buildInvoicePdf, signInvoiceLink } from '@/lib/invoice-pdf'

// GET /api/invoices/:id/pdf  (salesman: only invoices of his own orders)
export const GET = route(['FACTORY_ADMIN', 'ACCOUNTANT', 'OWNER', 'SALESMAN'], async ({ session, params }) => {
  if (params.action !== 'pdf') throw new HttpError(404, 'Not found')
  const id = Number(params.id)
  if (session.role === 'SALESMAN') {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { order: true } })
    if (!inv || inv.order.salesmanId !== session.userId) throw new HttpError(403, 'Not your invoice')
  }
  const bytes = await buildInvoicePdf(id)
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invoice-${id}.pdf"` },
  })
})

// POST /api/invoices/:id/(dispatch|cancel|share)
export const POST = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const id = Number(params.id)
  switch (params.action) {
    case 'dispatch':
      return dispatchInvoice(id, session.userId)
    case 'cancel': {
      const b = z.object({ reason: z.string().min(3), returnStock: z.boolean() }).parse(await req.json())
      return cancelInvoice(id, b.reason, session.userId, b.returnStock)
    }
    case 'share': {
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { invoiceNo: true } })
      const { exp, sig } = signInvoiceLink(id)
      const base = process.env.APP_URL || new URL(req.url).origin
      const url = `${base}/api/public/invoice/${id}?exp=${exp}&sig=${sig}`
      return { url, whatsapp: `https://wa.me/?text=${encodeURIComponent(`Invoice ${inv.invoiceNo}: ${url}`)}` }
    }
    default:
      throw new HttpError(404, 'Not found')
  }
})
