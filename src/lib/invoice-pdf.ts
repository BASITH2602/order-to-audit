/**
 * GST tax invoice PDF (pdf-lib) and expiring signed share links.
 * Standard PDF fonts have no rupee glyph, so amounts print as "Rs.".
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from './db'

function fmt(p: number): string {
  const neg = p < 0
  const a = Math.abs(p)
  return `${neg ? '-' : ''}Rs. ${Math.floor(a / 100).toLocaleString('en-IN')}.${String(a % 100).padStart(2, '0')}`
}

export async function buildInvoicePdf(invoiceId: number): Promise<Uint8Array> {
  const [settings, inv] = await Promise.all([
    prisma.setting.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { customer: true, lines: true, creditNotes: true } }),
  ])
  const products = await prisma.product.findMany({ where: { id: { in: inv.lines.map((l) => l.productId) } } })
  const nameOf = new Map(products.map((p) => [p.id, `${p.name} ${p.packLabel}`]))

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page = doc.addPage([595, 842])
  let y = 800
  const ink = rgb(0.1, 0.1, 0.1)
  const text = (t: string, x: number, size = 9, f = font) => page.drawText(t, { x, y, size, font: f, color: ink })
  const right = (t: string, xr: number, size = 9, f = font) =>
    page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color: ink })
  const rule = () => page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) })

  text(settings.companyName, 40, 15, bold)
  right('TAX INVOICE', 555, 13, bold)
  y -= 16
  text(`GSTIN: ${settings.gstin}`, 40)
  right(`Invoice No: ${inv.invoiceNo}`, 555, 10, bold)
  y -= 12
  text(`State: ${settings.stateName} (${settings.stateCode})`, 40)
  right(`Date: ${inv.createdAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`, 555)
  if (inv.status === 'CANCELLED') {
    y -= 12
    right(`CANCELLED - Credit note ${inv.creditNotes.map((c) => c.noteNo).join(', ')}`, 555, 9, bold)
  }
  y -= 22
  rule()
  y -= 14
  text('Bill to', 40, 9, bold)
  y -= 12
  text(inv.customer.name, 40, 10, bold)
  y -= 12
  text(`GSTIN: ${inv.customer.gstin ?? 'Unregistered'}`, 40)
  y -= 12
  text(`Place of supply: ${inv.customer.stateName} (${inv.customer.stateCode})`, 40)
  y -= 20

  const header = () => {
    rule()
    y -= 12
    text('#', 40, 9, bold)
    text('Description', 58, 9, bold)
    text('HSN', 240, 9, bold)
    right('Qty', 335, 9, bold)
    right('Rate', 400, 9, bold)
    right('Taxable', 480, 9, bold)
    right('GST %', 555, 9, bold)
    y -= 6
    rule()
    y -= 13
  }
  header()
  inv.lines.forEach((l, i) => {
    if (y < 150) {
      page = doc.addPage([595, 842])
      y = 800
      header()
    }
    text(String(i + 1), 40)
    text(nameOf.get(l.productId) ?? `Product ${l.productId}`, 58)
    text(l.hsn, 240)
    right(String(l.qty), 335)
    right(fmt(l.pricePaise), 400)
    right(fmt(l.taxablePaise), 480)
    right(`${l.gstRatePct}%`, 555)
    y -= 14
  })
  rule()
  y -= 16

  const row = (label: string, value: number, b = false) => {
    text(label, 380, 9, b ? bold : font)
    right(fmt(value), 555, 9, b ? bold : font)
    y -= 13
  }
  row('Taxable value', inv.taxablePaise)
  if (inv.intraState) {
    row('CGST', inv.cgstPaise)
    row('SGST', inv.sgstPaise)
  } else {
    row('IGST', inv.igstPaise)
  }
  row('Total', inv.totalPaise, true)
  y -= 20
  text('Reverse charge: No. Goods once sold will not be taken back except as agreed.', 40, 8)
  y -= 11
  text('This is a computer-generated invoice.', 40, 8)

  return doc.save()
}

// ---- Expiring signed share link (for WhatsApp / email) ----
function mac(id: number, exp: number): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required')
  return createHmac('sha256', secret).update(`invoice:${id}:${exp}`).digest('hex')
}

export function signInvoiceLink(id: number, days = 30): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + days * 86400
  return { exp, sig: mac(id, exp) }
}

export function verifyInvoiceLink(id: number, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false
  const a = Buffer.from(mac(id, exp))
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}
