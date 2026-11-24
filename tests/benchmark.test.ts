/**
 * Pure unit tests always run. The integration test replays Section 5 steps 1-3 and 8
 * against a freshly benchmark-seeded database:
 *   npx prisma migrate reset --force   (runs seed; needs BENCHMARK_PASSWORD)
 *   npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { runningAverage, variancePct, isFlagged, moneyPaise } from '../src/lib/costing'
import { prisma } from '../src/lib/db'
import { getBalance } from '../src/lib/stock'
import { postPurchase, postProductionRun, setRunOverheads, getRunCosting } from '../src/lib/stock'
import { buildReport, parseRange } from '../src/lib/reports'
import {
  submitOrder, approveOrder, issueInvoice, dispatchInvoice, checkOrderStock,
  recordPayment, getOutstanding, InsufficientStockError,
} from '../src/lib/sales'

describe('costing maths', () => {
  it('weighted average: 100 kg @ 4.2 + 60 kg @ 4.5 paise/g = 4.3125', () => {
    const r = runningAverage([
      { qtyDelta: 100_000, unitCost: '4.2' },
      { qtyDelta: 60_000, unitCost: '4.5' },
    ])
    expect(r.balance).toBe(160_000)
    expect(r.avgCost.toString()).toBe('4.3125')
  })

  it('issue leaves the average unchanged', () => {
    const r = runningAverage([
      { qtyDelta: 100_000, unitCost: '4.2' },
      { qtyDelta: 60_000, unitCost: '4.5' },
      { qtyDelta: -40_000, unitCost: '4.3125' },
    ])
    expect(r.balance).toBe(120_000)
    expect(r.avgCost.toString()).toBe('4.3125')
  })

  it('variance and flagging at 3% tolerance', () => {
    expect(variancePct(200, 188)!.toString()).toBe('-6')
    expect(variancePct(10_000, 10_500)!.toString()).toBe('5')
    expect(isFlagged(variancePct(200, 188), 3)).toBe(true)
    expect(isFlagged(variancePct(200, 194), 3)).toBe(false) // exactly -3% is not beyond tolerance
  })

  it('money rounds half-up to whole paise', () => {
    expect(moneyPaise(40_000, '4.3125')).toBe(172_500)
    expect(moneyPaise(1, '0.5')).toBe(1)
  })
})

describe('Section 5 benchmark (needs fresh benchmark seed)', () => {
  it('matches expected checkpoints', async () => {
    const sku = (s: string) => prisma.item.findUniqueOrThrow({ where: { sku: s } })
    const [flour, oil, spice, pouch, carton, fg] = await Promise.all(
      ['RM-FLOUR', 'RM-OIL', 'RM-SPICE', 'PK-POUCH200', 'PK-CARTON20', 'FG-MUR200'].map(sku),
    )
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })
    const supplier = await prisma.supplier.findFirstOrThrow()
    const bom = await prisma.bom.findFirstOrThrow()

    // Step 1: purchase 60 kg flour @ Rs 45/kg (4.5 paise/g)
    await postPurchase({
      supplierId: supplier.id,
      billNo: 'BENCH-1',
      date: new Date('2026-11-01'),
      userId: admin.id,
      lines: [{ itemId: flour.id, qty: 60_000, unitCost: '4.5' }],
    })

    // Steps 2-3: one batch. Pouches used = 188 good + 6 damaged = 194. Cartons used = 9.
    const run = await postProductionRun({
      bomId: bom.id,
      batches: 1,
      runDate: new Date('2026-11-02'),
      userId: admin.id,
      actuals: [
        { itemId: flour.id, actualQty: 40_000 },
        { itemId: oil.id, actualQty: 10_500 },
        { itemId: spice.id, actualQty: 1_200 },
        { itemId: pouch.id, actualQty: 194 },
        { itemId: carton.id, actualQty: 9 },
      ],
      goodOutput: 188,
      damagedPackets: 6,
    })

    expect(await getBalance(flour.id)).toBe(120_000)
    expect(await getBalance(oil.id)).toBe(19_500)
    expect(await getBalance(pouch.id)).toBe(306)
    expect(await getBalance(fg.id)).toBe(238)
    expect(run.yield.variancePct!.toString()).toBe('-6')
    expect(run.yield.flagged).toBe(true)
    const oilLine = run.lines.find((l) => l.itemId === oil.id)!
    expect(oilLine.variancePct!.toString()).toBe('5')
    expect(oilLine.flagged).toBe(true)

    // Step 8: overheads then cost per packet
    await setRunOverheads(run.runId, { labourPaise: 120_000, powerGasPaise: 60_000 }, admin.id)
    const c = await getRunCosting(run.runId)
    expect(c.materialPaise).toBe(405_500) // 172500 + 147000 + 24000 + 48500 + 13500
    expect(c.overheadPaise).toBe(180_000)
    expect(c.costPerPacketPaise!.toString()).toBe('3114.36') // Rs 31.14 per packet
  })

  // Runs after the production test above (same file = sequential), so finished goods start at 238.
  it('sales loop: Retailer A invoice and dispatch, Distributor B shortage, payment', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })
    const salesA = await prisma.user.findUniqueOrThrow({ where: { username: 'salesman_a' } })
    const salesB = await prisma.user.findUniqueOrThrow({ where: { username: 'salesman_b' } })
    const retailer = await prisma.customer.findFirstOrThrow({ where: { name: 'Retailer A' } })
    const distributor = await prisma.customer.findFirstOrThrow({ where: { name: 'Distributor B' } })
    const product = await prisma.product.findFirstOrThrow()

    // Step 4: Salesman A orders 150 (offline retry with the same clientRef must not duplicate)
    const orderA = await submitOrder({ customerId: retailer.id, salesmanId: salesA.id, clientRef: 'bench-A', lines: [{ productId: product.id, qty: 150 }] })
    const retry = await submitOrder({ customerId: retailer.id, salesmanId: salesA.id, clientRef: 'bench-A', lines: [{ productId: product.id, qty: 150 }] })
    expect(retry.id).toBe(orderA.id)

    // Step 5: approve, invoice (CGST+SGST), dispatch
    await approveOrder(orderA.id, admin.id)
    const inv = await issueInvoice(orderA.id, admin.id)
    expect(inv.intraState).toBe(true)
    expect([inv.taxablePaise, inv.cgstPaise, inv.sgstPaise, inv.igstPaise, inv.totalPaise]).toEqual([750_000, 18_750, 18_750, 0, 787_500])
    await dispatchInvoice(inv.id, admin.id)
    expect(await getBalance(product.itemId)).toBe(88)

    // Step 6: Distributor B orders 120, only 88 left -> 32 short, approval blocked
    const orderB = await submitOrder({ customerId: distributor.id, salesmanId: salesB.id, clientRef: 'bench-B', lines: [{ productId: product.id, qty: 120 }] })
    const check = await checkOrderStock(orderB.id)
    expect(check[0].shortage).toBe(32)
    await expect(approveOrder(orderB.id, admin.id)).rejects.toBeInstanceOf(InsufficientStockError)

    // Admin reduces to 88 and approves; Karnataka -> IGST
    const lineB = await prisma.orderLine.findFirstOrThrow({ where: { orderId: orderB.id } })
    await approveOrder(orderB.id, admin.id, [{ lineId: lineB.id, qty: 88 }])
    const invB = await issueInvoice(orderB.id, admin.id)
    expect(invB.intraState).toBe(false)
    expect([invB.cgstPaise, invB.sgstPaise, invB.igstPaise]).toEqual([0, 0, 22_000])

    // Step 7: Rs 4,000 from Retailer A leaves Rs 3,875
    await recordPayment({ customerId: retailer.id, invoiceId: inv.id, amountPaise: 400_000, mode: 'UPI', userId: admin.id })
    expect(await getOutstanding(retailer.id)).toBe(387_500)
  })

  // Step 9: monthly reports. A wide range covers the fixed 2026-11 run dates whenever the test is run.
  it('reports reconcile with the ledger and documents', async () => {
    const range = parseRange('2000-01-01', '2100-01-01')
    const find = (rows: any[], k: string, v: string) => rows.find((r) => r[k] === v)

    const reg = await buildReport('sales-register', range)
    expect(reg.totals!.total).toBe(787_500 + 462_000)

    const gst = await buildReport('gst-summary', range)
    const intra = gst.rows.find((r) => r.place === 'Intra-state')!
    const inter = gst.rows.find((r) => r.place === 'Inter-state')!
    expect([intra.taxable, intra.cgst, intra.sgst, intra.igst]).toEqual([750_000, 18_750, 18_750, 0])
    expect([inter.taxable, inter.igst]).toEqual([440_000, 22_000])

    const stock = await buildReport('stock-summary', range)
    expect(find(stock.rows, 'item', 'Flour')!.closing).toBe('120')
    expect(find(stock.rows, 'item', 'Cooking oil')!.closing).toBe('19.5')
    expect(find(stock.rows, 'item', '200 g pouch')!.closing).toBe('306')
    expect(find(stock.rows, 'item', 'Murukku 200 g')!.closing).toBe('88')

    const prod = await buildReport('production', range)
    const yieldRow = find(prod.rows, 'item', 'Finished packets (yield)')!
    expect([yieldRow.variance, yieldRow.flag, yieldRow.damaged]).toEqual(['-6', 'FLAGGED', 6])
    const oilRow = find(prod.rows, 'item', 'Cooking oil')!
    expect([oilRow.variance, oilRow.flag]).toEqual(['5', 'FLAGGED'])

    const cost = await buildReport('costing', range)
    expect([cost.rows[0].total, cost.rows[0].perPacket, cost.rows[0].marginPct]).toEqual([585_500, 3_114, '37.71'])

    expect((await buildReport('collections', range)).totals!.amount).toBe(400_000)
    expect((await buildReport('ageing', range)).totals!.total).toBe(387_500 + 462_000)

    // Ledger: running balance ends at the stock-summary closing for finished goods.
    const fgItem = await prisma.item.findUniqueOrThrow({ where: { sku: 'FG-MUR200' } })
    const ledger = await buildReport('stock-ledger', range, { itemId: fgItem.id })
    expect(ledger.rows[ledger.rows.length - 1].balance).toBe('88')
  })
})
