/**
 * Stock service. The ledger (StockMovement) is the only source of truth.
 * Quantities: base units (g / ml / pcs). unitCost: paise per base unit.
 */
import { Prisma, MovementType } from '@prisma/client'
import { prisma } from './db'
import { runningAverage, moneyPaise, variancePct, isFlagged, type Dec } from './costing'

type Db = Prisma.TransactionClient | typeof prisma

// ---------- Balances & valuation ----------

export async function getBalance(itemId: number, db: Db = prisma): Promise<number> {
  const r = await db.stockMovement.aggregate({ where: { itemId }, _sum: { qtyDelta: true } })
  return r._sum.qtyDelta ?? 0
}

export async function getValuation(itemId: number, db: Db = prisma) {
  const movs = await db.stockMovement.findMany({
    where: { itemId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { qtyDelta: true, unitCost: true },
  })
  return runningAverage(movs)
}

// ---------- Purchase ----------

export type PurchaseInput = {
  supplierId: number
  billNo: string
  date: Date
  userId: number
  lines: { itemId: number; qty: number; unitCost: string; batchNo?: string; expiry?: Date }[]
}

export async function postPurchase(input: PurchaseInput) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplierId: input.supplierId,
        billNo: input.billNo,
        date: input.date,
        createdById: input.userId,
        lines: { create: input.lines },
      },
    })
    for (const l of input.lines) {
      if (l.qty <= 0) throw new Error('Purchase quantity must be positive')
      await tx.stockMovement.create({
        data: {
          itemId: l.itemId,
          qtyDelta: l.qty,
          unitCost: l.unitCost,
          type: MovementType.PURCHASE,
          sourceType: 'PURCHASE',
          sourceId: String(purchase.id),
          batchNo: l.batchNo,
          expiry: l.expiry,
          createdById: input.userId,
          occurredAt: input.date,
        },
      })
    }
    await tx.auditLog.create({
      data: { entity: 'Purchase', entityId: String(purchase.id), action: 'CREATE', userId: input.userId, after: input as never },
    })
    return purchase
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

// ---------- Production run ----------

export type RunInput = {
  bomId: number
  batches: number
  runDate: Date
  userId: number
  /** actual base-unit quantity consumed per BOM item (raw AND packaging) */
  actuals: { itemId: number; actualQty: number }[]
  goodOutput: number
  damagedPackets: number // damaged pouches/packets, recorded for the report
  labourPaise?: number
  powerGasPaise?: number
  otherOverheadPaise?: number
}

export async function postProductionRun(input: RunInput) {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.setting.findUniqueOrThrow({ where: { id: 1 } })
    const bom = await tx.bom.findUniqueOrThrow({
      where: { id: input.bomId },
      include: { lines: true, product: true },
    })
    const actualByItem = new Map(input.actuals.map((a) => [a.itemId, a.actualQty]))
    const expectedOutput = bom.expectedYield * input.batches

    const count = await tx.productionRun.count()
    const ymd = input.runDate.toISOString().slice(0, 10).replace(/-/g, '')
    const run = await tx.productionRun.create({
      data: {
        runNo: `RUN-${ymd}-${String(count + 1).padStart(4, '0')}`,
        bomId: bom.id,
        batches: input.batches,
        runDate: input.runDate,
        expectedOutput,
        goodOutput: input.goodOutput,
        damagedPackets: input.damagedPackets,
        labourPaise: input.labourPaise ?? 0,
        powerGasPaise: input.powerGasPaise ?? 0,
        otherOverheadPaise: input.otherOverheadPaise ?? 0,
        createdById: input.userId,
      },
    })

    let materialCostPaise = 0
    const lineResults = []
    for (const bl of bom.lines) {
      const planned = bl.qtyPerBatch * input.batches
      const actual = actualByItem.get(bl.itemId)
      if (actual === undefined) throw new Error(`Missing actual quantity for item ${bl.itemId}`)

      const balance = await getBalance(bl.itemId, tx)
      if (balance < actual) throw new Error(`Insufficient stock for item ${bl.itemId}: have ${balance}, need ${actual}`)

      const { avgCost } = await getValuation(bl.itemId, tx)
      materialCostPaise += moneyPaise(actual, avgCost)

      await tx.productionRunLine.create({
        data: { runId: run.id, itemId: bl.itemId, plannedQty: planned, actualQty: actual, unitCost: avgCost.toString() },
      })
      await tx.stockMovement.create({
        data: {
          itemId: bl.itemId,
          qtyDelta: -actual,
          unitCost: avgCost.toString(),
          type: MovementType.PRODUCTION_ISSUE,
          sourceType: 'PRODUCTION_RUN',
          sourceId: String(run.id),
          createdById: input.userId,
          occurredAt: input.runDate,
        },
      })
      const pct = variancePct(planned, actual)
      lineResults.push({ itemId: bl.itemId, planned, actual, variancePct: pct, flagged: isFlagged(pct, settings.variancePctTol) })
    }

    // Finished goods in. Ledger cost = material cost per good packet (overheads are added to run costing).
    if (input.goodOutput > 0) {
      await tx.stockMovement.create({
        data: {
          itemId: bom.product.itemId,
          qtyDelta: input.goodOutput,
          unitCost: new Prisma.Decimal(materialCostPaise).div(input.goodOutput).toString(),
          type: MovementType.PRODUCTION_OUTPUT,
          sourceType: 'PRODUCTION_RUN',
          sourceId: String(run.id),
          createdById: input.userId,
          occurredAt: input.runDate,
        },
      })
    }

    const yPct = variancePct(expectedOutput, input.goodOutput)
    await tx.auditLog.create({
      data: { entity: 'ProductionRun', entityId: String(run.id), action: 'CREATE', userId: input.userId, after: { input, materialCostPaise } as never },
    })

    return {
      runId: run.id,
      runNo: run.runNo,
      materialCostPaise,
      lines: lineResults,
      yield: { expected: expectedOutput, actual: input.goodOutput, variancePct: yPct, flagged: isFlagged(yPct, settings.variancePctTol) },
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/** Add or change overheads after the run. Logged with before/after. */
export async function setRunOverheads(
  runId: number,
  o: { labourPaise?: number; powerGasPaise?: number; otherOverheadPaise?: number },
  userId: number,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.productionRun.findUniqueOrThrow({ where: { id: runId } })
    const after = await tx.productionRun.update({ where: { id: runId }, data: o })
    await tx.auditLog.create({
      data: { entity: 'ProductionRun', entityId: String(runId), action: 'UPDATE', userId, before: before as never, after: after as never },
    })
    return after
  })
}

/**
 * Costing rule (documented in the design note):
 *  - Materials and packaging at the weighted-average cost on the issue date, using ACTUAL consumed quantities
 *    (so wastage and damage are absorbed by good packets).
 *  - All run overheads (labour + power/gas + other) are spread equally over good packets of that run.
 *  cost per packet = (material + overheads) / good packets
 */
export async function getRunCosting(runId: number) {
  const run = await prisma.productionRun.findUniqueOrThrow({
    where: { id: runId },
    include: { lines: true, bom: { include: { product: true } } },
  })
  const materialPaise = run.lines.reduce((s, l) => s + moneyPaise(l.actualQty, l.unitCost), 0)
  const overheadPaise = run.labourPaise + run.powerGasPaise + run.otherOverheadPaise
  const totalPaise = materialPaise + overheadPaise
  const perPacket: Dec | null = run.goodOutput > 0 ? new Prisma.Decimal(totalPaise).div(run.goodOutput) : null
  const price = run.bom.product.pricePaise
  const marginPaise = perPacket ? new Prisma.Decimal(price).sub(perPacket) : null
  return {
    materialPaise,
    overheadPaise,
    totalPaise,
    costPerPacketPaise: perPacket?.toDecimalPlaces(2) ?? null,
    marginPerPacketPaise: marginPaise?.toDecimalPlaces(2) ?? null,
    marginPct: marginPaise ? marginPaise.mul(100).div(price).toDecimalPlaces(2) : null,
  }
}
