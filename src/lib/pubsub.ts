/**
 * One dedicated Postgres connection LISTENs for NOTIFY events and fans them out in-process
 * to every open SSE stream. Reconnects automatically.
 */
import { Client } from 'pg'

export type Listener = (channel: string, payload: Record<string, unknown> | null) => void
const CHANNELS = ['orders', 'stock', 'payments', 'alerts']

const g = globalThis as unknown as { __pubsub?: { listeners: Set<Listener>; started: boolean } }
const state = (g.__pubsub ??= { listeners: new Set<Listener>(), started: false })

async function connect(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  let dead = false
  const retry = () => {
    if (dead) return
    dead = true
    client.removeAllListeners()
    client.end().catch(() => {})
    setTimeout(connect, 2000)
  }
  client.on('notification', (m) => {
    let payload: Record<string, unknown> | null = null
    try {
      payload = m.payload ? JSON.parse(m.payload) : null
    } catch {}
    for (const l of state.listeners) l(m.channel, payload)
  })
  client.on('error', retry)
  client.on('end', retry)
  try {
    await client.connect()
    for (const c of CHANNELS) await client.query(`LISTEN ${c}`)
  } catch {
    retry()
  }
}

export function subscribe(fn: Listener): () => void {
  if (!state.started) {
    state.started = true
    void connect()
  }
  state.listeners.add(fn)
  return () => state.listeners.delete(fn)
}
