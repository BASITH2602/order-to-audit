/**
 * Production bootstrap: NO demo data.
 * Creates company settings and the first Factory Admin from environment variables.
 * All other users, masters, stock and transactions are entered through the app.
 *
 * Required env: COMPANY_NAME, COMPANY_GSTIN, COMPANY_STATE_CODE, COMPANY_STATE_NAME,
 *               ADMIN_USERNAME, ADMIN_PASSWORD
 * Run: npx tsx prisma/bootstrap.ts
 */
import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

async function main() {
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      companyName: need('COMPANY_NAME'),
      gstin: need('COMPANY_GSTIN'),
      stateCode: need('COMPANY_STATE_CODE'),
      stateName: need('COMPANY_STATE_NAME'),
      variancePctTol: 3,
    },
  })

  const username = need('ADMIN_USERNAME')
  const password = need('ADMIN_PASSWORD')
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters')

  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      name: 'Administrator',
      role: Role.FACTORY_ADMIN,
      passwordHash: await bcrypt.hash(password, 12),
    },
  })
  console.log('Bootstrap complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
