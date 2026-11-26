/**
 * Seed: loads the exact Section 5 master data and opening balances.
 * Units: quantities in base units (g / ml / pcs), money in paise,
 * unitCost = paise per BASE unit (Rs 45/kg => 4.5 paise/g).
 * Run: npx prisma db seed
 */
import { PrismaClient, Role, ItemKind, BaseUnit, MovementType } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // ---- Company (factory in Tamil Nadu, state code 33) ----
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      companyName: 'Demo Snacks Pvt Ltd',
      gstin: '33AAAAA0000A1Z9', // dummy
      stateCode: '33',
      stateName: 'Tamil Nadu',
      variancePctTol: 3,
    },
  })

  // ---- Users: one per role ----
  // Benchmark-only seed. Set BENCHMARK_PASSWORD in the environment (no hardcoded password).
  const benchPw = process.env.BENCHMARK_PASSWORD
  if (!benchPw) throw new Error('Set BENCHMARK_PASSWORD to run the benchmark seed')
  const pw = await bcrypt.hash(benchPw, 10)
  const users: [string, string, Role][] = [
    ['salesman_a', 'Salesman A', Role.SALESMAN],
    ['salesman_b', 'Salesman B', Role.SALESMAN],
    ['admin', 'Factory Admin', Role.FACTORY_ADMIN],
    ['production', 'Production Supervisor', Role.PRODUCTION],
    ['accountant', 'Accountant', Role.ACCOUNTANT],
    ['owner', 'Owner', Role.OWNER],
  ]
  for (const [username, name, role] of users) {
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, name, role, passwordHash: pw },
    })
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })

  // ---- Items ----
  const itemDefs = [
    { sku: 'RM-FLOUR', name: 'Flour', kind: ItemKind.RAW, baseUnit: BaseUnit.G, displayUnit: 'kg', displayFactor: 1000 },
    { sku: 'RM-OIL', name: 'Cooking oil', kind: ItemKind.RAW, baseUnit: BaseUnit.ML, displayUnit: 'L', displayFactor: 1000 },
    { sku: 'RM-SPICE', name: 'Salt and spice mix', kind: ItemKind.RAW, baseUnit: BaseUnit.G, displayUnit: 'kg', displayFactor: 1000 },
    { sku: 'PK-POUCH200', name: '200 g pouch', kind: ItemKind.PACKAGING, baseUnit: BaseUnit.PCS, displayUnit: 'pcs', displayFactor: 1 },
    { sku: 'PK-CARTON20', name: 'Carton (20 packets)', kind: ItemKind.PACKAGING, baseUnit: BaseUnit.PCS, displayUnit: 'pcs', displayFactor: 1 },
    { sku: 'FG-MUR200', name: 'Murukku 200 g', kind: ItemKind.FINISHED, baseUnit: BaseUnit.PCS, displayUnit: 'packets', displayFactor: 1 },
  ]
  for (const d of itemDefs) {
    await prisma.item.upsert({ where: { sku: d.sku }, update: {}, create: d })
  }
  const item = async (sku: string) => prisma.item.findUniqueOrThrow({ where: { sku } })
  const [flour, oil, spice, pouch, carton, fg] = await Promise.all(
    ['RM-FLOUR', 'RM-OIL', 'RM-SPICE', 'PK-POUCH200', 'PK-CARTON20', 'FG-MUR200'].map(item),
  )

  // ---- Product + BOM (1 batch = 200 packets) ----
  const product = await prisma.product.upsert({
    where: { itemId: fg.id },
    update: {},
    create: {
      name: 'Murukku',
      packLabel: '200 g',
      itemId: fg.id,
      hsn: '19059030', // dummy-but-plausible HSN for namkeen/savoury snacks
      gstRatePct: 5,
      pricePaise: 5000, // Rs 50
      packetsPerCarton: 20,
    },
  })

  const existingBom = await prisma.bom.findFirst({ where: { productId: product.id } })
  if (!existingBom) {
    await prisma.bom.create({
      data: {
        productId: product.id,
        expectedYield: 200,
        lines: {
          create: [
            { itemId: flour.id, qtyPerBatch: 40_000 }, // 40 kg
            { itemId: oil.id, qtyPerBatch: 10_000 }, // 10 L
            { itemId: spice.id, qtyPerBatch: 1_200 }, // 1.2 kg
            { itemId: pouch.id, qtyPerBatch: 200 },
            { itemId: carton.id, qtyPerBatch: 10 },
          ],
        },
      },
    })
  }

  // ---- Customers ----
  const customers = [
    { name: 'Retailer A', type: 'RETAILER', gstin: '33BBBBB1111B1ZU', stateCode: '33', stateName: 'Tamil Nadu' },
    { name: 'Distributor B', type: 'DISTRIBUTOR', gstin: '29CCCCC2222C1Z4', stateCode: '29', stateName: 'Karnataka' },
  ]
  for (const c of customers) {
    const found = await prisma.customer.findFirst({ where: { name: c.name } })
    if (!found) await prisma.customer.create({ data: c })
  }

  // ---- Supplier ----
  if (!(await prisma.supplier.findFirst({ where: { name: 'Demo Flour Mills' } }))) {
    await prisma.supplier.create({ data: { name: 'Demo Flour Mills' } })
  }

  // ---- Opening balances (written to the LEDGER, not to a balance column) ----
  const alreadyOpened = await prisma.stockMovement.count({ where: { type: MovementType.OPENING } })
  if (!alreadyOpened) {
    const opening = [
      { itemId: flour.id, qty: 100_000, cost: '4.2' }, // 100 kg @ Rs 42/kg = 4.2 paise/g
      { itemId: oil.id, qty: 30_000, cost: '14' }, // 30 L @ Rs 140/L = 14 paise/ml
      { itemId: spice.id, qty: 5_000, cost: '20' }, // 5 kg @ Rs 200/kg = 20 paise/g
      { itemId: pouch.id, qty: 500, cost: '250' }, // Rs 2.50
      { itemId: carton.id, qty: 30, cost: '1500' }, // Rs 15
      // ASSUMPTION: opening FG cost not given in the brief; Rs 30/packet invented.
      { itemId: fg.id, qty: 50, cost: '3000' },
    ]
    for (const o of opening) {
      await prisma.stockMovement.create({
        data: {
          itemId: o.itemId,
          qtyDelta: o.qty,
          unitCost: o.cost,
          type: MovementType.OPENING,
          sourceType: 'OPENING',
          note: 'Section 5 opening balance',
          createdById: admin.id,
        },
      })
    }
  }

  console.log('Seed complete. Logins (password from BENCHMARK_PASSWORD): salesman_a, salesman_b, admin, production, accountant, owner')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
