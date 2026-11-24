import { buildInvoicePdf, verifyInvoiceLink } from '@/lib/invoice-pdf'

// Public, no login: valid only with an unexpired HMAC signature made by the admin's Share action.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const u = new URL(req.url)
  if (!verifyInvoiceLink(Number(id), Number(u.searchParams.get('exp')), u.searchParams.get('sig') ?? '')) {
    return Response.json({ error: 'Link invalid or expired' }, { status: 403 })
  }
  const bytes = await buildInvoicePdf(Number(id))
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invoice-${id}.pdf"` },
  })
}
