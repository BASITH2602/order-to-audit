import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

const safe = { id: true, username: true, name: true, role: true, active: true, createdAt: true } as const

export const GET = route(['FACTORY_ADMIN'], () => prisma.user.findMany({ select: safe, orderBy: { id: 'asc' } }))

export const POST = route(['FACTORY_ADMIN'], async ({ session, req }) => {
  const b = z
    .object({
      username: z.string().regex(/^[a-z0-9_.-]{3,32}$/, 'Use 3 to 32 lowercase letters, digits, . _ -'),
      name: z.string().trim().min(2).max(60),
      role: z.enum(['SALESMAN', 'FACTORY_ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']),
      password: z.string().min(12, 'Password must be at least 12 characters'),
    })
    .parse(await req.json())
  const user = await prisma.user.create({ data: { username: b.username, name: b.name, role: b.role, passwordHash: await bcrypt.hash(b.password, 12) }, select: safe })
  await prisma.auditLog.create({ data: { entity: 'User', entityId: String(user.id), action: 'CREATE', userId: session.userId, after: user as never } })
  return user
})
