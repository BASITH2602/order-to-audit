/**
 * Server-Sent Events: live order, stock, payment and variance-alert updates.
 * Events carry ids only; clients refetch through the role-checked API, so nothing sensitive is pushed.
 * Visibility: a salesman only receives events about his own orders.
 */
import { getSession, type Session } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { subscribe } from '@/lib/pubsub'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function visible(s: Session, channel: string, p: Record<string, unknown> | null): Promise<boolean> {
  if (s.role !== 'SALESMAN') {
    if (channel === 'payments') return s.role !== 'PRODUCTION'
    return true
  }
  if (channel !== 'orders' || !p) return false
  let orderId = typeof p.orderId === 'number' ? p.orderId : undefined
  if (orderId === undefined && typeof p.invoiceId === 'number') {
    orderId = (await prisma.invoice.findUnique({ where: { id: p.invoiceId }, select: { orderId: true } }))?.orderId
  }
  if (orderId === undefined) return false
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { salesmanId: true } })
  return o?.salesmanId === s.userId
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {}
      }
      send('retry: 3000\n\n')
      const off = subscribe(async (channel, payload) => {
        if (await visible(session, channel, payload)) send(`event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`)
      })
      const ping = setInterval(() => send(': ping\n\n'), 25_000)
      req.signal.addEventListener('abort', () => {
        off()
        clearInterval(ping)
        try {
          controller.close()
        } catch {}
      })
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
