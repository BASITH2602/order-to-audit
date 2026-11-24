'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, rupees, useEvents, useUser } from '@/lib/client'
import { Header, StatusBadge, btnPrimary, card, field } from '@/components/ui'

type Customer = { id: number; name: string; type: string; stateName: string }
type Product = { id: number; name: string; packLabel: string; pricePaise: number }
type OrderRow = {
  id: number
  status: string
  createdAt: string
  customer: Customer
  lines: { id: number; qty: number; pricePaise: number; product: Product }[]
  invoice: { id: number; invoiceNo: string } | null
}
type Queued = { clientRef: string; customerId: number; lines: { productId: number; qty: number }[]; at: number }

const QKEY = 'ota_queue'
const CKEY = 'ota_cache'
const readQ = (): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(QKEY) ?? '[]')
  } catch {
    return []
  }
}
const writeQ = (q: Queued[]) => localStorage.setItem(QKEY, JSON.stringify(q))
const newRef = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export default function SalesPage() {
  const user = useUser(['SALESMAN'])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [qty, setQty] = useState<Record<number, number>>({})
  const [queue, setQueue] = useState<Queued[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const flushing = useRef(false)

  const loadOrders = useCallback(async () => {
    try {
      setOrders(await api<OrderRow[]>('/api/orders'))
    } catch {}
  }, [])

  // Masters: use the network when available, otherwise the last cached copy.
  useEffect(() => {
    ;(async () => {
      try {
        const [c, p] = await Promise.all([api<Customer[]>('/api/customers'), api<Product[]>('/api/products')])
        setCustomers(c)
        setProducts(p)
        localStorage.setItem(CKEY, JSON.stringify({ c, p }))
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem(CKEY) ?? 'null')
          if (cached) {
            setCustomers(cached.c)
            setProducts(cached.p)
          }
        } catch {}
      }
    })()
    setQueue(readQ())
    void loadOrders()
  }, [loadOrders])

  // Send queued offline orders. The server dedupes on clientRef, so retries are safe.
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      let q = readQ()
      for (const item of q) {
        try {
          await api('/api/orders', { method: 'POST', json: { customerId: item.customerId, clientRef: item.clientRef, lines: item.lines } })
          q = q.filter((x) => x.clientRef !== item.clientRef)
          writeQ(q)
        } catch (e: any) {
          if (e.status && e.status < 500) {
            q = q.filter((x) => x.clientRef !== item.clientRef) // server rejected it; retrying will not help
            writeQ(q)
            setMsg({ ok: false, text: `A queued order was rejected: ${e.message}` })
          } else break // no network or server down: keep it and try later
        }
      }
      setQueue(readQ())
      await loadOrders()
    } finally {
      flushing.current = false
    }
  }, [loadOrders])

  useEffect(() => {
    void flush()
    const t = setInterval(flush, 15_000)
    window.addEventListener('online', flush)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', flush)
    }
  }, [flush])

  useEvents(() => void loadOrders())

  const lines = useMemo(
    () => Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ productId: Number(id), qty: q })),
    [qty],
  )
  const totalPaise = lines.reduce((s, l) => s + l.qty * (products.find((p) => p.id === l.productId)?.pricePaise ?? 0), 0)

  async function submit() {
    if (!customerId || lines.length === 0) return
    setBusy(true)
    setMsg(null)
    const payload = { customerId: Number(customerId), clientRef: newRef(), lines }
    try {
      await api('/api/orders', { method: 'POST', json: payload })
      setMsg({ ok: true, text: 'Order sent to the factory.' })
    } catch (e: any) {
      if (e.status && e.status < 500) {
        setMsg({ ok: false, text: e.message })
        setBusy(false)
        return
      }
      const q = [...readQ(), { ...payload, at: Date.now() }]
      writeQ(q)
      setQueue(q)
      setMsg({ ok: true, text: 'No network. Saved on this phone and will be sent automatically.' })
    }
    setQty({})
    setBusy(false)
    void loadOrders()
  }

  const salesByCustomer = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) {
      if (o.status === 'REJECTED') continue
      m.set(o.customer.name, (m.get(o.customer.name) ?? 0) + o.lines.reduce((s, l) => s + l.qty * l.pricePaise, 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [orders])

  return (
    <div className="mx-auto max-w-md pb-28">
      <Header title="New order" user={user?.name} />
      <div className="space-y-4 p-4">
        {queue.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {queue.length} order{queue.length > 1 ? 's' : ''} waiting to send
          </div>
        )}
        {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

        <select className={`${field} h-12 text-base`} value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Select customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.stateName}
            </option>
          ))}
        </select>

        <div className="space-y-2">
          {products.map((p) => {
            const q = qty[p.id] ?? 0
            return (
              <div key={p.id} className={`${card} flex items-center justify-between`}>
                <div>
                  <div className="font-medium">
                    {p.name} {p.packLabel}
                  </div>
                  <div className="text-sm text-neutral-500">{rupees(p.pricePaise)} per packet</div>
                </div>
                <div className="flex items-center gap-2">
                  <button aria-label="less" className="h-10 w-10 rounded-full border text-xl" onClick={() => setQty({ ...qty, [p.id]: Math.max(0, q - 1) })}>
                    −
                  </button>
                  <input
                    inputMode="numeric"
                    className="h-10 w-16 rounded-lg border text-center"
                    value={q || ''}
                    placeholder="0"
                    onChange={(e) => setQty({ ...qty, [p.id]: Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)) })}
                  />
                  <button aria-label="more" className="h-10 w-10 rounded-full border text-xl" onClick={() => setQty({ ...qty, [p.id]: q + 1 })}>
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">My orders</h2>
        <div className="space-y-2">
          {orders.length === 0 && <p className="text-sm text-neutral-500">No orders yet.</p>}
          {orders.map((o) => (
            <div key={o.id} className={card}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #{o.id} · {o.customer.name}
                </span>
                <StatusBadge status={o.status} />
              </div>
              <div className="mt-1 text-sm text-neutral-600">
                {o.lines.map((l) => `${l.qty} × ${l.product.name} ${l.product.packLabel}`).join(', ')}
              </div>
              {o.invoice && (
                <a className="mt-1 inline-block text-sm text-emerald-700 underline" href={`/api/invoices/${o.invoice.id}/pdf`} target="_blank">
                  Invoice {o.invoice.invoiceNo}
                </a>
              )}
            </div>
          ))}
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Customer-wise sales (before GST)</h2>
        <div className={card}>
          {salesByCustomer.length === 0 && <p className="text-sm text-neutral-500">Nothing yet.</p>}
          {salesByCustomer.map(([name, paise]) => (
            <div key={name} className="flex justify-between py-1 text-sm">
              <span>{name}</span>
              <span className="font-medium">{rupees(paise)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-500">{lines.reduce((s, l) => s + l.qty, 0)} packets, before GST</div>
            <div className="text-lg font-semibold">{rupees(totalPaise)}</div>
          </div>
          <button className={`${btnPrimary} h-12 px-8 text-base`} disabled={busy || !customerId || lines.length === 0} onClick={submit}>
            {busy ? 'Sending…' : 'Submit order'}
          </button>
        </div>
      </div>
    </div>
  )
}
