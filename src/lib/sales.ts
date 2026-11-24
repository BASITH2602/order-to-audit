/**
 * Sales loop: order -> approval (stock check) -> GST invoice -> dispatch -> payments.
 * Role checks live in the API layer; this module enforces business rules.
 * Money: integer paise. Stock: ledger movements only.
 */
import { Prisma, MovementType, OrderStatus, InvoiceStatus } from '@prisma/client'
import { prisma } from './db'
import { getBalance, getValuation } from './stock'
import { computeGst, financialYear } from './gst'
import { notify } from './events'

type Db = Prisma.TransactionClient | typeof prisma
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }

export type Shortage = { productId: number; need: number; available: number; shortage: number }

export class InsufficientStockError extends Error {
  constructor(public shortages: Shortage[]) {
    super('Insufficient finished-goods stock')
  }
}

// ---------- Order entry (salesman) ----------

export async function submitOrder(input: {
  customerId: number
  salesmanId: number
  clientRef?: string // idempotency key generated on the phone; makes offline retries safe
  lines: { productId: number; qty: number }[]
}) {
  if (input.lines.length === 0) throw new Error('Order needs at least one line')
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('Quantity must be a positive whole number')
  }
  if (input.clientRef) {
    const existing = await prisma.order.findUnique({ where: { clientRef: input.clientRef } })
    if (existing) return existing
  }
  const products = await prisma.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) } } })
  const priceOf = new Map(products.map((p) => [p.id, p.pricePaise]))

  try {
    const order = await prisma.order.create({
      data: {
        customerId: input.customerId,
        salesmanId: input.salesmanId,
        clientRef: input.clientRef,
        lines: {
          create: input.lines.map((l) => {
            const price = priceOf.get(l.productId)
            if (price === undefined) throw new Error(`Unknown product ${l.productId}`)
            return { productId: l.productId, qty: l.qty, pricePaise: price }
          }),
        },
      },
    })
    await notify('orders', { type: 'order.submitted', orderId: order.id })
    return order
  } catch (e) {
    // Two simultaneous retries with the same clientRef: return the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && input.clientRef) {
      return prisma.order.findUniqueOrThrow({ where: { clientRef: input.clientRef } })
    }
    throw e
  }
}

// ---------- Stock check ----------

/**
 * Available = ledger balance minus quantities already promised to OTHER approved/invoiced
 * (not yet dispatched) orders. Dispatched orders are already out of the ledger.
 */
export async function checkOrderStock(orderId: number, db: Db = prisma): Promise<Shortage[]> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: { include: { product: true } } },
  })
  const need = new Map<number, { qty: number; itemId: number }>()
  for (const l of order.lines) {
    const cur = need.get(l.productId)
    need.set(l.productId, { qty: (cur?.qty ?? 0) + l.qty, itemId: l.product.itemId })
  }
  const out: Shortage[] = []
  for (const [productId, { qty, itemId }] of need) {
    const balance = await getBalance(itemId, db)
    const committed = await db.orderLine.aggregate({
      where: { productId, orderId: { not: orderId }, order: { status: { in: [OrderStatus.APPROVED, OrderStatus.INVOICED] } } },
      _sum: { qty: true },
    })
    const available = balance - (committed._sum.qty ?? 0)
    out.push({ productId, need: qty, available, shortage: Math.max(0, qty - available) })
  }
  return out
}

// ---------- Admin: approve / reject ----------

export async function approveOrder(
  orderId: number,
  userId: number,
  edits: { lineId: number; qty?: number; pricePaise?: number }[] = [],
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } })
    if (order.status !== OrderStatus.SUBMITTED) throw new Error(`Order is ${order.status}, cannot approve`)

    for (const e of edits) {
      const line = order.lines.find((l) => l.id === e.lineId)
      if (!line) throw new Error(`Line ${e.lineId} is not on this order`)
      if (e.qty !== undefined && (!Number.isInteger(e.qty) || e.qty <= 0)) throw new Error('Quantity must be a positive whole number')
      if (e.pricePaise !== undefined && (!Number.isInteger(e.pricePaise) || e.pricePaise < 0)) throw new Error('Invalid price')
      const after = await tx.orderLine.update({ where: { id: line.id }, data: { qty: e.qty, pricePaise: e.pricePaise } })
      await tx.auditLog.create({
        data: { entity: 'OrderLine', entityId: String(line.id), action: 'UPDATE', userId, before: line as never, after: after as never },
      })
    }

    // Stock check after edits. A shortage rolls the whole transaction back, including the edits.
    const shortages = (await checkOrderStock(orderId, tx)).filter((s) => s.shortage > 0)
    if (shortages.length > 0) throw new InsufficientStockError(shortages)

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.APPROVED } })
    await tx.auditLog.create({
      data: { entity: 'Order', entityId: String(orderId), action: 'UPDATE', userId, before: { status: order.status }, after: { status: 'APPROVED' } },
    })
    return updated
  }, SERIALIZABLE)
  await notify('orders', { type: 'order.approved', orderId })
  return result
}

export async function rejectOrder(orderId: number, userId: number, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
    if (order.status !== OrderStatus.SUBMITTED) throw new Error(`Order is ${order.status}, cannot reject`)
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.REJECTED } })
    await tx.auditLog.create({
      data: { entity: 'Order', entityId: String(orderId), action: 'UPDATE', userId, before: { status: order.status }, after: { status: 'REJECTED', reason } },
    })
    return updated
  })
  await notify('orders', { type: 'order.rejected', orderId })
  return result
}

// ---------- GST invoice ----------

export async function issueInvoice(orderId: number, userId: number, now: Date = new Date()) {
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.setting.findUniqueOrThrow({ where: { id: 1 } })
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { customer: true, lines: { include: { product: true } } },
    })
    if (order.status !== OrderStatus.APPROVED) throw new Error(`Order is ${order.status}, only APPROVED orders can be invoiced`)

    const intraState = order.customer.stateCode === settings.stateCode
    const lines = order.lines.map((l) => ({
      productId: l.productId,
      hsn: l.product.hsn,
      qty: l.qty,
      pricePaise: l.pricePaise,
      taxablePaise: l.qty * l.pricePaise,
      gstRatePct: l.product.gstRatePct,
    }))
    const gst = computeGst(lines, intraState)

    // Cancelled invoices keep their numbers, so counting all invoices in the FY gives a gap-free series.
    const fy = financialYear(now, settings.fyStartMonth)
    const seq = (await tx.invoice.count({ where: { fy } })) + 1
    const invoiceNo = `${fy}/${String(seq).padStart(4, '0')}`

    const invoice = await tx.invoice.create({
      data: {
        invoiceNo,
        fy,
        orderId,
        customerId: order.customerId,
        intraState,
        ...gst,
        lines: { create: lines },
      },
      include: { lines: true },
    })
    await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.INVOICED } })
    await tx.auditLog.create({
      data: { entity: 'Invoice', entityId: String(invoice.id), action: 'CREATE', userId, after: invoice as never },
    })
    return invoice
  }, SERIALIZABLE)
  await notify('orders', { type: 'order.invoiced', orderId, invoiceId: result.id })
  return result
}

// ---------- Dispatch ----------

export async function dispatchInvoice(invoiceId: number, userId: number, now: Date = new Date()) {
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } })
    if (invoice.status !== InvoiceStatus.POSTED) throw new Error('Only a POSTED invoice can be dispatched')
    if (invoice.dispatchedAt) throw new Error('Invoice already dispatched')

    const products = await tx.product.findMany({ where: { id: { in: invoice.lines.map((l) => l.productId) } } })
    const itemOf = new Map(products.map((p) => [p.id, p.itemId]))

    const shortages: Shortage[] = []
    for (const l of invoice.lines) {
      const balance = await getBalance(itemOf.get(l.productId)!, tx)
      if (balance < l.qty) shortages.push({ productId: l.productId, need: l.qty, available: balance, shortage: l.qty - balance })
    }
    if (shortages.length > 0) throw new InsufficientStockError(shortages)

    for (const l of invoice.lines) {
      const itemId = itemOf.get(l.productId)!
      const { avgCost } = await getValuation(itemId, tx)
      await tx.stockMovement.create({
        data: {
          itemId,
          qtyDelta: -l.qty,
          unitCost: avgCost.toString(),
          type: MovementType.DISPATCH,
          sourceType: 'INVOICE',
          sourceId: String(invoiceId),
          createdById: userId,
          occurredAt: now,
        },
      })
    }
    const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { dispatchedAt: now } })
    await tx.order.update({ where: { id: invoice.orderId }, data: { status: OrderStatus.DISPATCHED } })
    await tx.auditLog.create({
      data: { entity: 'Invoice', entityId: String(invoiceId), action: 'UPDATE', userId, before: { dispatchedAt: null }, after: { dispatchedAt: now.toISOString() } },
    })
    return updated
  }, SERIALIZABLE)
  await notify('stock', { type: 'stock.changed', invoiceId })
  await notify('orders', { type: 'order.dispatched', invoiceId })
  return result
}

// ---------- Payments & outstanding ----------

/** Outstanding = all invoices - credit notes - payments. A cancelled invoice nets to zero via its credit note. */
export async function getOutstanding(customerId: number, db: Db = prisma): Promise<number> {
  const [inv, cn, pay] = await Promise.all([
    db.invoice.aggregate({ where: { customerId }, _sum: { totalPaise: true } }),
    db.creditNote.aggregate({ where: { invoice: { customerId } }, _sum: { amountPaise: true } }),
    db.payment.aggregate({ where: { customerId }, _sum: { amountPaise: true } }),
  ])
  return (inv._sum.totalPaise ?? 0) - (cn._sum.amountPaise ?? 0) - (pay._sum.amountPaise ?? 0)
}

export async function recordPayment(input: {
  customerId: number
  invoiceId?: number
  amountPaise: number
  mode: string
  userId: number
  receivedAt?: Date
}) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error('Payment must be a positive amount in paise')
  const result = await prisma.$transaction(async (tx) => {
    if (input.invoiceId) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } })
      if (inv.customerId !== input.customerId) throw new Error('Invoice belongs to a different customer')
      const [cn, paid] = await Promise.all([
        tx.creditNote.aggregate({ where: { invoiceId: inv.id }, _sum: { amountPaise: true } }),
        tx.payment.aggregate({ where: { invoiceId: inv.id }, _sum: { amountPaise: true } }),
      ])
      const due = inv.totalPaise - (cn._sum.amountPaise ?? 0) - (paid._sum.amountPaise ?? 0)
      if (input.amountPaise > due) throw new Error(`Payment exceeds invoice balance of ${due} paise`)
    }
    const payment = await tx.payment.create({
      data: {
        customerId: input.customerId,
        invoiceId: input.invoiceId,
        amountPaise: input.amountPaise,
        mode: input.mode,
        createdById: input.userId,
        receivedAt: input.receivedAt ?? new Date(),
      },
    })
    await tx.auditLog.create({
      data: { entity: 'Payment', entityId: String(payment.id), action: 'CREATE', userId: input.userId, after: payment as never },
    })
    return payment
  }, SERIALIZABLE)
  await notify('payments', { type: 'payment.recorded', customerId: input.customerId })
  return result
}

// ---------- Cancellation via credit note (never delete) ----------

export async function cancelInvoice(invoiceId: number, reason: string, userId: number, returnStock: boolean) {
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } })
    if (invoice.status !== InvoiceStatus.POSTED) throw new Error('Invoice is already cancelled')

    const seq = (await tx.creditNote.count()) + 1
    const note = await tx.creditNote.create({
      data: { noteNo: `CN/${invoice.fy}/${String(seq).padStart(4, '0')}`, invoiceId, amountPaise: invoice.totalPaise, reason },
    })
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.CANCELLED } })

    if (invoice.dispatchedAt && returnStock) {
      const products = await tx.product.findMany({ where: { id: { in: invoice.lines.map((l) => l.productId) } } })
      const itemOf = new Map(products.map((p) => [p.id, p.itemId]))
      for (const l of invoice.lines) {
        const itemId = itemOf.get(l.productId)!
        // Return at the original dispatch cost, traced back to the dispatch movement.
        const original = await tx.stockMovement.findFirstOrThrow({
          where: { sourceType: 'INVOICE', sourceId: String(invoiceId), type: MovementType.DISPATCH, itemId },
        })
        await tx.stockMovement.create({
          data: {
            itemId,
            qtyDelta: l.qty,
            unitCost: original.unitCost.toString(),
            type: MovementType.SALES_RETURN,
            sourceType: 'CREDIT_NOTE',
            sourceId: String(note.id),
            createdById: userId,
          },
        })
      }
    }
    await tx.auditLog.create({
      data: { entity: 'Invoice', entityId: String(invoiceId), action: 'CANCEL', userId, before: { status: invoice.status }, after: { status: 'CANCELLED', creditNote: note.noteNo, reason, returnStock } },
    })
    return note
  }, SERIALIZABLE)
  await notify('stock', { type: 'stock.changed', invoiceId })
  return result
}
