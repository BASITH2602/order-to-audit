import { prisma } from './db'

/**
 * Publish a real-time event through Postgres NOTIFY. The SSE endpoint (added with the UI)
 * LISTENs on these channels and pushes to connected browsers.
 * Best-effort: a failed notify must never fail the business transaction, so call it AFTER commit.
 */
export async function notify(channel: string, payload: unknown): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT pg_notify(${channel}, ${JSON.stringify(payload)})`
  } catch (e) {
    console.error('notify failed', e)
  }
}
