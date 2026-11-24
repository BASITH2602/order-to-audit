/**
 * Section 4.6 reports. Every report is built from the ledger and the posted documents;
 * nothing is stored separately. Money = integer paise, quantities = display-unit strings.
 * Ranges are IST calendar days, inclusive of both dates.
 */
import { Prisma, MovementType } from '@prisma/client'
import { prisma } from './db'
import { computeGst } from './gst'
import { variancePct, isFlagged, moneyPaise } from './costing'
import { toDisplayQty } from './units'
import { getRunCosting } from './stock'
import { HttpError } from './errors'
import type { Col, Report, Row } from './report-catalog'

const IST_MS = 19_800_000
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10)

// ---------- Date range ----------

function checkDate(s?: string | null): string | null {
  if (!s) return null
  let ok = false
  try {
    ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
  } catch {}
  if (!ok) throw new Error(`Invalid date "${s}", use YYYY-MM-DD`)
  return s
}

export type Range = { from: Date; to: Date; fromStr: string; toStr: string } // `to` is exclusive (midnight after the last day)

export function parseRange(fromS?: string | null, toS?: string | null, now = new Date()): Range {
  const today = istDate(now)
  const f = checkDate(fromS) ?? `${today.slice(0, 8)}01`
  const t = checkDate(toS) ?? today
  if (f > t) throw new Error('"From" date is after "To" date')
  const from = new Date(`${f}T00:00:00+05:30`)
  const to = new Date(new Date(`${t}T00:00:00+05:30`).getTime() + 86_400_000)
  return { from, to, fromStr: f, toStr: t }
}

// ---------- helpers ----------

const sub = (r: Range) => `${r.fromStr} to ${r.toStr}`

function totalRow(cols: Col[], rows: Row[], labelKey: string): Row {
  const t: Row = {}
  for (const c of cols) t[c.key] = c.kind === 'money' || c.kind === 'int' ? rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null
  t[labelKey] = 'Total'
  return t
}

function make(name: string, title: string, r: Range, columns: Col[], rows: Row[], totalLabelKey?: string): Report {
  return { name, title, subtitle: sub(r), columns, rows, totals: totalLabelKey ? totalRow(columns, rows, totalLabelKey) : undefined }
}

const text = (key: string, label: string): Col => ({ key, label, kind: 'text' })
const date = (key: string, label: string): Col => ({ key, label, kind: 'date' })
const int = (key: string, label: string): Col => ({ key, label, kind: 'int' })
const money = (key: string, label: string): Col => ({ key, label, kind: 'money' })
const qty = (key: string, label: string): Col => ({ key, label, kind: 'qty' })
const pct = (key: string, label: string): Col => ({ key, label, kind: 'pct' })

// ---------- sales documents (invoices +, credit notes -) ----------
// GSTR-1 style netting: an invoice appears in the period it was issued, its credit note in the period it was raised.

type DocLine = { productId: number; hsn: string; qty: number; taxable: number; rate: number } // unsigned
type SalesDoc = {
  docType: 'Invoice' | 'Credit note'
  docNo: string
  ref: string
  date: Date
  status: string
  sign: 1 | -1
  customer: { id: number; name: string; gstin: string | null; stateName: string }
  intra: boolean
  taxable: number // signed
  cgst: number
  sgst: number
  igst: number
  total: number
  lines: DocLine[]
}

async function salesDocs(r: Range): Promise<SalesDoc[]> {
  const [invoices, notes] = await Promise.all([
    prisma.invoice.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, include: { customer: true, lines: true } }),
    prisma.creditNote.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, include: { invoice: { include: { customer: true, lines: true } } } }),
  ])
  const mk = (inv: (typeof invoices)[number], sign: 1 | -1, docType: SalesDoc['docType'], docNo: string, d: Date, status: string): SalesDoc => ({
    docType,
    docNo,
    ref: inv.invoiceNo,
    date: d,
    status,
    sign,
    customer: { id: inv.customer.id, name: inv.customer.name, gstin: inv.customer.gstin, stateName: inv.customer.stateName },
    intra: inv.intraState,
    taxable: sign * inv.taxablePaise,
    cgst: sign * inv.cgstPaise,
    sgst: sign * inv.sgstPaise,
    igst: sign * inv.igstPaise,
    total: sign * inv.totalPaise,
    lines: inv.lines.map((l) => ({ productId: l.productId, hsn: l.hsn, qty: l.qty, taxable: l.taxablePaise, rate: l.gstRatePct })),
  })
  const docs = [
    ...invoices.map((i) => mk(i, 1, 'Invoice', i.invoiceNo, i.createdAt, i.status === 'CANCELLED' ? 'Cancelled later' : 'Posted')),
    ...notes.map((n) => mk(n.invoice, -1, 'Credit note', n.noteNo, n.createdAt, 'Credit note')),
  ]
  return docs.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Tax by rate for one document, signed. Same per-rate rounding rule as the invoice itself. */
function byRate(d: SalesDoc) {
  const groups = new Map<number, DocLine[]>()
  for (const l of d.lines) groups.set(l.rate, [...(groups.get(l.rate) ?? []), l])
  return [...groups].map(([rate, ls]) => {
    const g = computeGst(ls.map((l) => ({ taxablePaise: l.taxable, gstRatePct: rate })), d.intra)
    return { rate, taxable: d.sign * g.taxablePaise, cgst: d.sign * g.cgstPaise, sgst: d.sign * g.sgstPaise, igst: d.sign * g.igstPaise }
  })
}

// ---------- individual reports ----------

async function salesRegister(r: Range): Promise<Report> {
  const docs = await salesDocs(r)
  const cols = [date('date', 'Date'), text('type', 'Type'), text('docNo', 'Document no.'), text('ref', 'Against invoice'), text('customer', 'Customer'), text('gstin', 'GSTIN'), text('place', 'Place of supply'), money('taxable', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('total', 'Total'), text('status', 'Status')]
  const rows = docs.map((d) => ({ date: istDate(d.date), type: d.docType, docNo: d.docNo, ref: d.ref, customer: d.customer.name, gstin: d.customer.gstin ?? '', place: d.customer.stateName, taxable: d.taxable, cgst: d.cgst, sgst: d.sgst, igst: d.igst, total: d.total, status: d.status }))
  return make('sales-register', 'Sales register (net of credit notes)', r, cols, rows, 'docNo')
}

async function salesByCustomer(r: Range): Promise<Report> {
  const docs = await salesDocs(r)
  const m = new Map<number, Row>()
  for (const d of docs) {
    const cur = m.get(d.customer.id) ?? { customer: d.customer.name, gstin: d.customer.gstin ?? '', state: d.customer.stateName, taxable: 0, tax: 0, total: 0 }
    cur.taxable = (cur.taxable as number) + d.taxable
    cur.tax = (cur.tax as number) + d.cgst + d.sgst + d.igst
    cur.total = (cur.total as number) + d.total
    m.set(d.customer.id, cur)
  }
  const cols = [text('customer', 'Customer'), text('gstin', 'GSTIN'), text('state', 'State'), money('taxable', 'Taxable'), money('tax', 'GST'), money('total', 'Total')]
  const rows = [...m.values()].sort((a, b) => (b.total as number) - (a.total as number))
  return make('sales-by-customer', 'Customer-wise sales', r, cols, rows, 'customer')
}

async function salesByProduct(r: Range): Promise<Report> {
  const docs = await salesDocs(r)
  const products = await prisma.product.findMany()
  const name = new Map(products.map((p) => [p.id, `${p.name} ${p.packLabel}`]))
  const m = new Map<number, Row>()
  for (const d of docs) {
    for (const l of d.lines) {
      const cur = m.get(l.productId) ?? { product: name.get(l.productId) ?? `Product ${l.productId}`, hsn: l.hsn, qty: 0, taxable: 0 }
      cur.qty = (cur.qty as number) + d.sign * l.qty
      cur.taxable = (cur.taxable as number) + d.sign * l.taxable
      m.set(l.productId, cur)
    }
  }
  const cols = [text('product', 'Product'), text('hsn', 'HSN'), int('qty', 'Packets'), money('taxable', 'Taxable value')]
  return make('sales-by-product', 'Product-wise sales', r, cols, [...m.values()], 'product')
}

async function gstSummary(r: Range): Promise<Report> {
  const docs = await salesDocs(r)
  const m = new Map<string, Row>()
  for (const d of docs) {
    const supply = d.customer.gstin ? 'B2B (registered)' : 'B2C (unregistered)'
    const place = d.intra ? 'Intra-state' : 'Inter-state'
    for (const g of byRate(d)) {
      const key = `${supply}|${place}|${g.rate}`
      const cur = m.get(key) ?? { supply, place, rate: `${g.rate}%`, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }
      cur.taxable = (cur.taxable as number) + g.taxable
      cur.cgst = (cur.cgst as number) + g.cgst
      cur.sgst = (cur.sgst as number) + g.sgst
      cur.igst = (cur.igst as number) + g.igst
      cur.tax = (cur.tax as number) + g.cgst + g.sgst + g.igst
      m.set(key, cur)
    }
  }
  const cols = [text('supply', 'Supply type (GSTR-1 table 4 / 7)'), text('place', 'Place of supply'), text('rate', 'Rate'), money('taxable', 'Taxable value'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('tax', 'Total tax')]
  return make('gst-summary', 'GST summary of outward supplies (net of credit notes; maps to GSTR-3B 3.1(a))', r, cols, [...m.values()].sort((a, b) => String(a.supply).localeCompare(String(b.supply))), 'supply')
}

async function gstHsn(r: Range): Promise<Report> {
  const docs = await salesDocs(r)
  const m = new Map<string, Row>()
  for (const d of docs) {
    const groups = new Map<string, DocLine[]>()
    for (const l of d.lines) groups.set(`${l.hsn}|${l.rate}`, [...(groups.get(`${l.hsn}|${l.rate}`) ?? []), l])
    for (const [key, ls] of groups) {
      const g = computeGst(ls.map((l) => ({ taxablePaise: l.taxable, gstRatePct: ls[0].rate })), d.intra)
      const cur = m.get(key) ?? { hsn: ls[0].hsn, uqc: 'PKT', rate: `${ls[0].rate}%`, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      cur.qty = (cur.qty as number) + d.sign * ls.reduce((s, l) => s + l.qty, 0)
      cur.taxable = (cur.taxable as number) + d.sign * g.taxablePaise
      cur.cgst = (cur.cgst as number) + d.sign * g.cgstPaise
      cur.sgst = (cur.sgst as number) + d.sign * g.sgstPaise
      cur.igst = (cur.igst as number) + d.sign * g.igstPaise
      m.set(key, cur)
    }
  }
  const cols = [text('hsn', 'HSN'), text('uqc', 'UQC'), text('rate', 'Rate'), int('qty', 'Quantity'), money('taxable', 'Taxable value'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST')]
  return make('gst-hsn', 'HSN-wise summary of outward supplies', r, cols, [...m.values()], 'hsn')
}

async function purchaseRegister(r: Range): Promise<Report> {
  const purchases = await prisma.purchase.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { supplier: true, lines: true }, orderBy: { date: 'asc' } })
  const items = await prisma.item.findMany()
  const item = new Map(items.map((i) => [i.id, i]))
  const rows: Row[] = []
  for (const p of purchases) {
    for (const l of p.lines) {
      const it = item.get(l.itemId)!
      rows.push({
        date: istDate(p.date),
        supplier: p.supplier.name,
        gstin: p.supplier.gstin ?? '',
        billNo: p.billNo,
        item: it.name,
        qty: toDisplayQty(l.qty, it.displayFactor),
        unit: it.displayUnit,
        rate: new Prisma.Decimal(l.unitCost).mul(it.displayFactor).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
        value: moneyPaise(l.qty, l.unitCost),
      })
    }
  }
  const cols = [date('date', 'Date'), text('supplier', 'Supplier'), text('gstin', 'Supplier GSTIN'), text('billNo', 'Bill no.'), text('item', 'Item'), qty('qty', 'Quantity'), text('unit', 'Unit'), money('rate', 'Rate per unit'), money('value', 'Value')]
  return make('purchase-register', 'Purchase register', r, cols, rows, 'billNo')
}

const RECEIPT_TYPES: MovementType[] = [MovementType.PURCHASE, MovementType.PRODUCTION_OUTPUT, MovementType.SALES_RETURN, MovementType.OPENING]
const ISSUE_TYPES: MovementType[] = [MovementType.PRODUCTION_ISSUE, MovementType.DISPATCH, MovementType.PRODUCTION_DAMAGE]

async function stockSummary(r: Range): Promise<Report> {
  const [items, before, within] = await Promise.all([
    prisma.item.findMany({ orderBy: [{ kind: 'asc' }, { id: 'asc' }] }),
    prisma.stockMovement.groupBy({ by: ['itemId'], where: { occurredAt: { lt: r.from } }, _sum: { qtyDelta: true } }),
    prisma.stockMovement.groupBy({ by: ['itemId', 'type'], where: { occurredAt: { gte: r.from, lt: r.to } }, _sum: { qtyDelta: true } }),
  ])
  const open = new Map(before.map((b) => [b.itemId, b._sum.qtyDelta ?? 0]))
  const rows: Row[] = items.map((i) => {
    const mine = within.filter((w) => w.itemId === i.id)
    const sum = (types: MovementType[]) => mine.filter((m) => types.includes(m.type)).reduce((s, m) => s + (m._sum.qtyDelta ?? 0), 0)
    const opening = open.get(i.id) ?? 0
    const receipts = sum(RECEIPT_TYPES)
    const issues = -sum(ISSUE_TYPES)
    const adj = sum([MovementType.ADJUSTMENT])
    const f = i.displayFactor
    return {
      item: i.name,
      kind: i.kind.toLowerCase(),
      unit: i.displayUnit,
      opening: toDisplayQty(opening, f),
      receipts: toDisplayQty(receipts, f),
      issues: toDisplayQty(issues, f),
      adjustments: toDisplayQty(adj, f),
      closing: toDisplayQty(opening + receipts - issues + adj, f),
    }
  })
  const cols = [text('item', 'Item'), text('kind', 'Type'), text('unit', 'Unit'), qty('opening', 'Opening'), qty('receipts', 'Receipts'), qty('issues', 'Issues / sales'), qty('adjustments', 'Adjustments'), qty('closing', 'Closing')]
  return make('stock-summary', 'Stock summary: opening + receipts - issues +/- adjustments = closing', r, cols, rows)
}

async function stockLedger(r: Range, itemId?: number): Promise<Report> {
  const itemFilter = itemId ? { itemId } : {}
  const [items, before, moves] = await Promise.all([
    prisma.item.findMany({ where: itemId ? { id: itemId } : {}, orderBy: { id: 'asc' } }),
    prisma.stockMovement.groupBy({ by: ['itemId'], where: { ...itemFilter, occurredAt: { lt: r.from } }, _sum: { qtyDelta: true } }),
    prisma.stockMovement.findMany({ where: { ...itemFilter, occurredAt: { gte: r.from, lt: r.to } }, orderBy: [{ itemId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }] }),
  ])
  // Resolve source documents to readable numbers.
  const ids = (t: string) => [...new Set(moves.filter((m) => m.sourceType === t && m.sourceId).map((m) => Number(m.sourceId)))]
  const [pur, runs, invs, cns] = await Promise.all([
    prisma.purchase.findMany({ where: { id: { in: ids('PURCHASE') } }, select: { id: true, billNo: true } }),
    prisma.productionRun.findMany({ where: { id: { in: ids('PRODUCTION_RUN') } }, select: { id: true, runNo: true } }),
    prisma.invoice.findMany({ where: { id: { in: ids('INVOICE') } }, select: { id: true, invoiceNo: true } }),
    prisma.creditNote.findMany({ where: { id: { in: ids('CREDIT_NOTE') } }, select: { id: true, noteNo: true } }),
  ])
  const label = (t: string, id: string | null): string => {
    const n = Number(id)
    if (t === 'PURCHASE') return `Purchase bill ${pur.find((x) => x.id === n)?.billNo ?? id}`
    if (t === 'PRODUCTION_RUN') return `Production ${runs.find((x) => x.id === n)?.runNo ?? id}`
    if (t === 'INVOICE') return `Invoice ${invs.find((x) => x.id === n)?.invoiceNo ?? id}`
    if (t === 'CREDIT_NOTE') return `Credit note ${cns.find((x) => x.id === n)?.noteNo ?? id}`
    return t === 'OPENING' ? 'Opening balance entry' : `Adjustment ${id ?? ''}`.trim()
  }
  const open = new Map(before.map((b) => [b.itemId, b._sum.qtyDelta ?? 0]))
  const rows: Row[] = []
  for (const it of items) {
    let bal = open.get(it.id) ?? 0
    const f = it.displayFactor
    rows.push({ date: r.fromStr, item: it.name, type: 'Balance brought forward', doc: '', in: null, out: null, balance: toDisplayQty(bal, f), rate: null })
    for (const m of moves.filter((x) => x.itemId === it.id)) {
      bal += m.qtyDelta
      rows.push({
        date: istDate(m.occurredAt),
        item: it.name,
        type: m.type.replace(/_/g, ' ').toLowerCase(),
        doc: label(m.sourceType, m.sourceId),
        in: m.qtyDelta > 0 ? toDisplayQty(m.qtyDelta, f) : null,
        out: m.qtyDelta < 0 ? toDisplayQty(-m.qtyDelta, f) : null,
        balance: toDisplayQty(bal, f),
        rate: new Prisma.Decimal(m.unitCost).mul(f).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
      })
    }
  }
  const cols = [date('date', 'Date'), text('item', 'Item'), text('type', 'Movement'), text('doc', 'Source document'), qty('in', 'In'), qty('out', 'Out'), qty('balance', 'Balance'), money('rate', 'Rate per unit')]
  return make('stock-ledger', 'Stock ledger (quantities in each item\'s display unit)', r, cols, rows)
}

async function production(r: Range): Promise<Report> {
  const settings = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })
  const runs = await prisma.productionRun.findMany({
    where: { runDate: { gte: r.from, lt: r.to } },
    include: { lines: { include: { item: true } }, bom: { include: { product: true } } },
    orderBy: { runDate: 'asc' },
  })
  const rows: Row[] = []
  const flag = (p: Prisma.Decimal | null) => (isFlagged(p, settings.variancePctTol) ? 'FLAGGED' : '')
  for (const run of runs) {
    const product = `${run.bom.product.name} ${run.bom.product.packLabel}`
    for (const l of run.lines) {
      const v = variancePct(l.plannedQty, l.actualQty)
      rows.push({ run: run.runNo, date: istDate(run.runDate), product, item: l.item.name, unit: l.item.displayUnit, planned: toDisplayQty(l.plannedQty, l.item.displayFactor), actual: toDisplayQty(l.actualQty, l.item.displayFactor), variance: v?.toString() ?? null, flag: flag(v), damaged: null })
    }
    const y = variancePct(run.expectedOutput, run.goodOutput)
    rows.push({ run: run.runNo, date: istDate(run.runDate), product, item: 'Finished packets (yield)', unit: 'packets', planned: String(run.expectedOutput), actual: String(run.goodOutput), variance: y?.toString() ?? null, flag: flag(y), damaged: run.damagedPackets })
  }
  const cols = [text('run', 'Run'), date('date', 'Date'), text('product', 'Product'), text('item', 'Item'), text('unit', 'Unit'), qty('planned', 'Planned'), qty('actual', 'Actual'), pct('variance', 'Variance %'), text('flag', `Beyond +/-${settings.variancePctTol}%`), int('damaged', 'Damaged pouches / packets')]
  return make('production', 'Production: planned vs actual consumption, yield and wastage', r, cols, rows)
}

async function costing(r: Range): Promise<Report> {
  const runs = await prisma.productionRun.findMany({ where: { runDate: { gte: r.from, lt: r.to } }, include: { bom: { include: { product: true } } }, orderBy: { runDate: 'asc' } })
  const rows: Row[] = []
  const rd = (d: Prisma.Decimal | null) => (d ? d.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber() : null)
  for (const run of runs) {
    const c = await getRunCosting(run.id)
    rows.push({
      run: run.runNo,
      date: istDate(run.runDate),
      product: `${run.bom.product.name} ${run.bom.product.packLabel}`,
      good: run.goodOutput,
      materials: c.materialPaise,
      overheads: c.overheadPaise,
      total: c.totalPaise,
      perPacket: rd(c.costPerPacketPaise),
      price: run.bom.product.pricePaise,
      margin: rd(c.marginPerPacketPaise),
      marginPct: c.marginPct?.toString() ?? null,
    })
  }
  const cols = [text('run', 'Run'), date('date', 'Date'), text('product', 'Product'), int('good', 'Good packets'), money('materials', 'Materials'), money('overheads', 'Overheads'), money('total', 'Total cost'), money('perPacket', 'Cost per packet'), money('price', 'Selling price'), money('margin', 'Margin per packet'), pct('marginPct', 'Margin %')]
  return make('costing', 'Cost per packet (weighted-average materials on actual use + overheads spread over good packets)', r, cols, rows)
}

async function collections(r: Range): Promise<Report> {
  const pays = await prisma.payment.findMany({ where: { receivedAt: { gte: r.from, lt: r.to } }, include: { customer: true, invoice: true }, orderBy: { receivedAt: 'asc' } })
  const rows: Row[] = pays.map((p) => ({ date: istDate(p.receivedAt), customer: p.customer.name, invoice: p.invoice?.invoiceNo ?? 'On account', mode: p.mode, amount: p.amountPaise }))
  const cols = [date('date', 'Date'), text('customer', 'Customer'), text('invoice', 'Against invoice'), text('mode', 'Mode'), money('amount', 'Amount received')]
  return make('collections', 'Payments and collections', r, cols, rows, 'mode')
}

/** Ageing as of the end of the chosen "To" date. On-account payments and customer credits clear the oldest invoices first. */
async function ageing(r: Range): Promise<Report> {
  const [invoices, onAccount] = await Promise.all([
    prisma.invoice.findMany({
      where: { createdAt: { lt: r.to } },
      include: { customer: true, creditNotes: { where: { createdAt: { lt: r.to } } }, payments: { where: { receivedAt: { lt: r.to } } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payment.findMany({ where: { invoiceId: null, receivedAt: { lt: r.to } } }),
  ])
  const asOf = r.to.getTime() - 1
  const byCustomer = new Map<number, { name: string; dues: { age: number; due: number }[]; credit: number }>()
  const entry = (id: number, name: string) => {
    if (!byCustomer.has(id)) byCustomer.set(id, { name, dues: [], credit: 0 })
    return byCustomer.get(id)!
  }
  for (const inv of invoices) {
    const e = entry(inv.customerId, inv.customer.name)
    const due = inv.totalPaise - inv.creditNotes.reduce((s, c) => s + c.amountPaise, 0) - inv.payments.reduce((s, p) => s + p.amountPaise, 0)
    if (due >= 0) e.dues.push({ age: Math.floor((asOf - inv.createdAt.getTime()) / 86_400_000), due })
    else e.credit += -due // paid before cancellation: customer credit
  }
  for (const p of onAccount) {
    const e = byCustomer.get(p.customerId)
    if (e) e.credit += p.amountPaise
    else byCustomer.set(p.customerId, { name: '', dues: [], credit: p.amountPaise })
  }
  const names = new Map((await prisma.customer.findMany()).map((c) => [c.id, c.name]))
  const rows: Row[] = []
  for (const [id, e] of byCustomer) {
    let credit = e.credit
    const b = [0, 0, 0, 0]
    for (const d of e.dues) {
      const use = Math.min(credit, d.due)
      credit -= use
      const left = d.due - use
      b[d.age <= 30 ? 0 : d.age <= 60 ? 1 : d.age <= 90 ? 2 : 3] += left
    }
    const total = b[0] + b[1] + b[2] + b[3] - credit
    if (total === 0 && b.every((x) => x === 0)) continue
    rows.push({ customer: e.name || names.get(id) || `Customer ${id}`, b0: b[0], b1: b[1], b2: b[2], b3: b[3], credit: -credit, total })
  }
  const cols = [text('customer', 'Customer'), money('b0', '0-30 days'), money('b1', '31-60 days'), money('b2', '61-90 days'), money('b3', 'Over 90 days'), money('credit', 'Unapplied credit'), money('total', 'Total outstanding')]
  return { ...make('ageing', `Outstanding receivables with ageing as of ${r.toStr}`, r, cols, rows, 'customer'), subtitle: `As of ${r.toStr}` }
}

export async function buildReport(name: string, r: Range, opts: { itemId?: number } = {}): Promise<Report> {
  switch (name) {
    case 'sales-register': return salesRegister(r)
    case 'sales-by-customer': return salesByCustomer(r)
    case 'sales-by-product': return salesByProduct(r)
    case 'gst-summary': return gstSummary(r)
    case 'gst-hsn': return gstHsn(r)
    case 'purchase-register': return purchaseRegister(r)
    case 'stock-summary': return stockSummary(r)
    case 'stock-ledger': return stockLedger(r, opts.itemId)
    case 'production': return production(r)
    case 'costing': return costing(r)
    case 'collections': return collections(r)
    case 'ageing': return ageing(r)
    default: throw new HttpError(404, `Unknown report "${name}"`)
  }
}
