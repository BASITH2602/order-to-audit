/**
 * Route wrapper: role check -> handler -> uniform JSON errors.
 * Status mapping:
 *   HttpError -> its status        ZodError -> 400 with issues
 *   InsufficientStockError -> 409 with the shortage list
 *   plain Error (our business-rule messages) -> 422     Prisma not-found -> 404
 *   anything else -> 500 with a generic message (details only in server logs)
 */
import { Prisma, type Role } from '@prisma/client'
import { ZodError } from 'zod'
import { requireRole, type Session } from './auth'
import { HttpError } from './errors'
import { InsufficientStockError } from './sales'

type Ctx = { session: Session; req: Request; params: Record<string, string> }

export function route(roles: Role[], fn: (c: Ctx) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<any> }) => {
    try {
      const session = await requireRole(roles)
      const params = ((await ctx?.params) ?? {}) as Record<string, string>
      const data = await fn({ session, req, params })
      if (data instanceof Response) return data
      return Response.json(data ?? { ok: true })
    } catch (e) {
      return errorResponse(e)
    }
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status })
  if (e instanceof ZodError) return Response.json({ error: 'Invalid input', issues: e.issues }, { status: 400 })
  if (e instanceof InsufficientStockError) return Response.json({ error: e.message, shortages: e.shortages }, { status: 409 })
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return Response.json({ error: 'Not found' }, { status: 404 })
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return Response.json({ error: 'Already exists' }, { status: 409 })
  if (e instanceof Error && e.constructor === Error) return Response.json({ error: e.message }, { status: 422 })
  console.error(e)
  return Response.json({ error: 'Internal error' }, { status: 500 })
}
