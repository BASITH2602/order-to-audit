import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { route } from '@/lib/api'

const safe = { id: true, username: true, name: true, role: true, active: true } as const

export const PATCH = route(['FACTORY_ADMIN'], async ({ session, req, params }) => {
  const b = z
    .object({
      role: z.enum(['SALESMAN', 'FACTORY_ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']).optional(),
      active: z.boolean().optional(),
      password: z.string().min(12, 'Password must be at least 12 characters').optional(),
    })
    .parse(await req.json())
  const id = Number(params.id)
  if (id === session.userId && (b.role !== undefined || b.active === false)) throw new Error('You cannot change your own role or deactivate yourself')

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id }, select: safe })
    const loses = (b.role !== undefined && b.role !== 'FACTORY_ADMIN') || b.active === false
    if (before.role === 'FACTORY_ADMIN' && before.active && loses) {
      const others = await tx.user.count({ where: { role: 'FACTORY_ADMIN', active: true, id: { not: id } } })
      if (others === 0) throw new Error('At least one active factory admin must remain')
    }
    const after = await tx.user.update({
      where: { id },
      data: { role: b.role, active: b.active, ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 12) } : {}) },
      select: safe,
    })
    await tx.auditLog.create({
      data: { entity: 'User', entityId: String(id), action: 'UPDATE', userId: session.userId, before: before as never, after: { ...after, passwordChanged: !!b.password } as never },
    })
    return after
  })
})
