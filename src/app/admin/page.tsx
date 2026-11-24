'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, rupees, rupeesToPaise, useEvents, useUser } from '@/lib/client'
import { Header, StatusBadge, btnDanger, btnGhost, btnPrimary, card, field } from '@/components/ui'
import StockTable from '@/components/StockTable'

type Tab = 'orders' | 'receivables' | 'stock'
const FILTERS = ['SUBMITTED', 'APPROVED', 'INVOICED', 'DISPATCHED', 'REJECTED', 'ALL'] as const

export default function AdminPage() {
  const user = useUser(['FACTORY_ADMIN'])
  const [tab, setTab] = useState<Tab>('orders')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('SUBMITTED')
  const [orders, setOrders] = useState<any[]>([])
  const [receivables, setReceivables] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])

  const reload = useCallback(async () => {
    const [o, r, s] = await Promise.all([api('/api/orders'), api('/api/receivables'), api('/api/stock')])
    setOrders(o)
    setReceivables(r)
    setStock(s)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])
  useEvents(() => void reload())

  const shown = filter === 'ALL' ? orders : orders.filter((o) => o.status === filter)
  const count = (s: string) => orders.filter((o) => o.status === s).length

  return (
    <div className="mx-auto max-w-5xl">
      <Header title="Factory admin" user={user?.name} />
      <nav className="flex gap-2 border-b bg-white px-4 py-2">
        <span className="ml-auto order-last flex gap-1">
          <a href="/masters" className="rounded-lg px-3 py-1.5 text-sm text-emerald-700 hover:bg-neutral-100">
            Masters
          </a>
          <a href="/reports" className="rounded-lg px-3 py-1.5 text-sm text-emerald-700 hover:bg-neutral-100">
            Reports
          </a>
        </span>
        {(['orders', 'receivables', 'stock'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm capitalize ${tab === t ? 'bg-emerald-700 text-white' : 'hover:bg-neutral-100'}`}>
            {t}
            {t === 'orders' && count('SUBMITTED') > 0 && <span className="ml-2 rounded-full bg-amber-400 px-1.5 text-xs text-black">{count('SUBMITTED')}</span>}
          </button>
        ))}
      </nav>

      <div className="space-y-3 p-4">
        {tab === 'orders' && (
          <>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'bg-white'}`}>
                  {f.toLowerCase()}
                </button>
              ))}
            </div>
            {shown.length === 0 && <p className="text-sm text-neutral-500">No orders here.</p>}
            {shown.map((o) => (
              <OrderCard key={o.id} o={o} reload={reload} />
            ))}
          </>
        )}

        {tab === 'receivables' && (
          <div className={card}>
            <h2 className="mb-2 font-semibold">Outstanding by customer</h2>
            {receivables.length === 0 && <p className="text-sm text-neutral-500">Nothing outstanding.</p>}
            {receivables.map((r) => (
              <div key={r.customerId} className="flex justify-between border-t py-2 text-sm first:border-t-0">
                <span>{r.name}</span>
                <span className="font-medium">{rupees(r.outstandingPaise)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{rupees(receivables.reduce((s, r) => s + r.outstandingPaise, 0))}</span>
            </div>
          </div>
        )}

        {tab === 'stock' && <StockTable rows={stock} />}
      </div>
    </div>
  )
}

function OrderCard({ o, reload }: { o: any; reload: () => Promise<void> }) {
  const [edits, setEdits] = useState<Record<number, { qty: string; price: string }>>(
    Object.fromEntries(o.lines.map((l: any) => [l.id, { qty: String(l.qty), price: (l.pricePaise / 100).toFixed(2) }])),
  )
  const [stock, setStock] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pay, setPay] = useState({ amount: '', mode: 'UPI' })
  const [showPay, setShowPay] = useState(false)

  // Before approval the admin sees at once whether finished goods cover the order.
  useEffect(() => {
    if (o.status === 'SUBMITTED') api(`/api/orders/${o.id}/stock-check`).then(setStock).catch(() => {})
  }, [o.id, o.status])

  async function run(fn: () => Promise<unknown>) {
    setErr('')
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e: any) {
      const sh = e.data?.shortages as any[] | undefined
      setErr(sh ? `Not enough stock: short by ${sh.map((s) => s.shortage).join(', ')} packets (available ${sh.map((s) => s.available).join(', ')}). Reduce the quantity and approve again.` : e.message)
    } finally {
      setBusy(false)
    }
  }

  const approve = () =>
    run(() => {
      const changes = o.lines
        .map((l: any) => {
          const e = edits[l.id]
          const qty = parseInt(e.qty, 10)
          const pricePaise = rupeesToPaise(e.price)
          return { lineId: l.id, qty: qty !== l.qty ? qty : undefined, pricePaise: pricePaise !== l.pricePaise ? pricePaise : undefined }
        })
        .filter((c: any) => c.qty !== undefined || c.pricePaise !== undefined)
      return api(`/api/orders/${o.id}/approve`, { method: 'POST', json: { edits: changes } })
    })
  const reject = () => {
    const reason = window.prompt('Reason for rejecting this order?')
    if (reason) void run(() => api(`/api/orders/${o.id}/reject`, { method: 'POST', json: { reason } }))
  }
  const share = () =>
    run(async () => {
      const r = await api<{ url: string; whatsapp: string }>(`/api/invoices/${o.invoice.id}/share`, { method: 'POST' })
      window.open(r.whatsapp, '_blank')
    })
  const cancel = () => {
    const reason = window.prompt('Reason for cancelling this invoice? A credit note will be raised.')
    if (!reason) return
    const returnStock = o.status === 'DISPATCHED' ? window.confirm('Goods are coming back. Add them back to stock?') : false
    void run(() => api(`/api/invoices/${o.invoice.id}/cancel`, { method: 'POST', json: { reason, returnStock } }))
  }
  const record = () =>
    run(async () => {
      await api('/api/payments', { method: 'POST', json: { customerId: o.customerId, invoiceId: o.invoice.id, amountPaise: rupeesToPaise(pay.amount), mode: pay.mode } })
      setPay({ amount: '', mode: 'UPI' })
      setShowPay(false)
    })

  const editable = o.status === 'SUBMITTED'
  const short = stock?.filter((s) => s.shortage > 0) ?? []

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">
            #{o.id} · {o.customer.name}
          </span>
          <span className="ml-2 text-sm text-neutral-500">
            {o.customer.stateName} · by {o.salesman?.name} · {new Date(o.createdAt).toLocaleString('en-IN')}
          </span>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <table className="mt-2 w-full text-sm">
        <tbody>
          {o.lines.map((l: any) => (
            <tr key={l.id} className="border-t">
              <td className="py-1.5">
                {l.product.name} {l.product.packLabel}
              </td>
              <td className="w-24">
                {editable ? <input className={field} inputMode="numeric" value={edits[l.id].qty} onChange={(e) => setEdits({ ...edits, [l.id]: { ...edits[l.id], qty: e.target.value } })} /> : l.qty}
              </td>
              <td className="w-28 pl-2 text-right">
                {editable ? <input className={field} inputMode="decimal" value={edits[l.id].price} onChange={(e) => setEdits({ ...edits, [l.id]: { ...edits[l.id], price: e.target.value } })} /> : rupees(l.pricePaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editable && stock && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${short.length ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {short.length
            ? `Stock short by ${short.map((s) => s.shortage).join(', ')} packets (available ${short.map((s) => s.available).join(', ')}).`
            : `Stock covers this order (${stock.map((s) => s.available).join(', ')} available).`}
        </p>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {o.status === 'SUBMITTED' && (
          <>
            <button className={btnPrimary} disabled={busy} onClick={approve}>
              Approve
            </button>
            <button className={btnDanger} disabled={busy} onClick={reject}>
              Reject
            </button>
          </>
        )}
        {o.status === 'APPROVED' && (
          <button className={btnPrimary} disabled={busy} onClick={() => run(() => api(`/api/orders/${o.id}/invoice`, { method: 'POST' }))}>
            Raise GST invoice
          </button>
        )}
        {o.status === 'INVOICED' && (
          <button className={btnPrimary} disabled={busy} onClick={() => run(() => api(`/api/invoices/${o.invoice.id}/dispatch`, { method: 'POST' }))}>
            Record dispatch
          </button>
        )}
        {o.invoice && (
          <>
            <a className={btnGhost} href={`/api/invoices/${o.invoice.id}/pdf`} target="_blank">
              Invoice {o.invoice.invoiceNo} (PDF)
            </a>
            <button className={btnGhost} disabled={busy} onClick={share}>
              Share on WhatsApp
            </button>
            {o.invoice.status === 'POSTED' && (
              <>
                <button className={btnGhost} onClick={() => setShowPay(!showPay)}>
                  Record payment
                </button>
                <button className={btnGhost} disabled={busy} onClick={cancel}>
                  Cancel invoice
                </button>
              </>
            )}
            {o.invoice.status === 'CANCELLED' && <span className="self-center text-sm text-red-600">Invoice cancelled (credit note raised)</span>}
          </>
        )}
      </div>

      {showPay && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-neutral-50 p-3">
          <label className="text-sm">
            Amount (₹)
            <input className={`${field} mt-1 w-36`} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          </label>
          <label className="text-sm">
            Mode
            <select className={`${field} mt-1`} value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
              {['UPI', 'CASH', 'BANK', 'CHEQUE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className={btnPrimary} disabled={busy || !pay.amount} onClick={record}>
            Save payment
          </button>
        </div>
      )}
    </div>
  )
}
