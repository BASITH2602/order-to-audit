'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtQty, rupees, rupeesToPaise, useEvents, useUser } from '@/lib/client'
import { Flag, Header, btnGhost, btnPrimary, card, field } from '@/components/ui'
import StockTable from '@/components/StockTable'

type Tab = 'run' | 'receive' | 'stock'
const today = () => new Date().toISOString().slice(0, 10)

export default function ProductionPage() {
  const user = useUser(['PRODUCTION', 'FACTORY_ADMIN'])
  const [tab, setTab] = useState<Tab>('run')
  const [stock, setStock] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [alert, setAlert] = useState('')

  const reload = useCallback(async () => {
    const [s, p, sp, r] = await Promise.all([api('/api/stock'), api('/api/products'), api('/api/suppliers'), api('/api/production-runs')])
    setStock(s)
    setProducts(p)
    setSuppliers(sp)
    setRuns(r)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  useEvents((ch, p) => {
    if (ch === 'alerts') setAlert(`Variance flagged on ${p.runNo}`)
    void reload()
  })

  return (
    <div className="mx-auto max-w-4xl">
      <Header title="Production floor" user={user?.name} />
      <nav className="flex gap-2 border-b bg-white px-4 py-2">
        {([['run', 'Production run'], ['receive', 'Receive material'], ['stock', 'Stock']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-emerald-700 text-white' : 'hover:bg-neutral-100'}`}>
            {label}
          </button>
        ))}
      </nav>
      <div className="space-y-4 p-4">
        {alert && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{alert}</div>}
        {tab === 'run' && <RunForm products={products} stock={stock} runs={runs} reload={reload} />}
        {tab === 'receive' && <ReceiveForm stock={stock} suppliers={suppliers} reload={reload} />}
        {tab === 'stock' && <StockTable rows={stock} />}
      </div>
    </div>
  )
}

function ReceiveForm({ stock, suppliers, reload }: { stock: any[]; suppliers: any[]; reload: () => Promise<void> }) {
  const items = stock.filter((i) => i.kind !== 'FINISHED')
  const [supplierId, setSupplierId] = useState('')
  const [newSupplier, setNewSupplier] = useState('')
  const [billNo, setBillNo] = useState('')
  const [date, setDate] = useState(today())
  const [lines, setLines] = useState([{ itemId: '', qty: '', rate: '' }])
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function addSupplier() {
    const s = await api('/api/suppliers', { method: 'POST', json: { name: newSupplier } })
    setNewSupplier('')
    await reload()
    setSupplierId(String(s.id))
  }

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      await api('/api/purchases', {
        method: 'POST',
        json: {
          supplierId: Number(supplierId),
          billNo,
          date,
          lines: lines.map((l) => ({ itemId: Number(l.itemId), qty: l.qty, ratePaise: rupeesToPaise(l.rate) })),
        },
      })
      setMsg({ ok: true, t: 'Receipt saved. Stock updated.' })
      setLines([{ itemId: '', qty: '', rate: '' }])
      setBillNo('')
      await reload()
    } catch (e: any) {
      setMsg({ ok: false, t: e.message })
    }
    setBusy(false)
  }

  const valid = supplierId && billNo && lines.every((l) => l.itemId && l.qty && l.rate)
  return (
    <div className={`${card} space-y-3`}>
      <h2 className="font-semibold">Receive raw / packaging material</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <select className={field} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className={field} placeholder="Bill no." value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <input className={field} placeholder="New supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
        <button className={btnGhost} disabled={newSupplier.length < 2} onClick={addSupplier}>
          Add
        </button>
      </div>
      {lines.map((l, i) => {
        const unit = items.find((x) => String(x.itemId) === l.itemId)?.displayUnit
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
            <select className={field} value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
              <option value="">Item</option>
              {items.map((it) => (
                <option key={it.itemId} value={it.itemId}>
                  {it.name}
                </option>
              ))}
            </select>
            <input className={field} inputMode="decimal" placeholder={`Quantity${unit ? ` (${unit})` : ''}`} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <input className={field} inputMode="decimal" placeholder={`Rate ₹${unit ? ` per ${unit}` : ''}`} value={l.rate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
          </div>
        )
      })}
      <div className="flex gap-2">
        <button className={btnGhost} onClick={() => setLines([...lines, { itemId: '', qty: '', rate: '' }])}>
          Add line
        </button>
        <button className={btnPrimary} disabled={busy || !valid} onClick={save}>
          Save receipt
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</p>}
    </div>
  )
}

function RunForm({ products, stock, runs, reload }: { products: any[]; stock: any[]; runs: any[]; reload: () => Promise<void> }) {
  const withBom = products.filter((p) => p.boms?.length)
  const [productId, setProductId] = useState('')
  const [batches, setBatches] = useState('1')
  const [date, setDate] = useState(today())
  const [actuals, setActuals] = useState<Record<number, string>>({})
  const [good, setGood] = useState('')
  const [damaged, setDamaged] = useState('0')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<any>(null)

  const product = withBom.find((p) => String(p.id) === productId)
  const bom = product?.boms[0]
  const meta = useMemo(() => new Map(stock.map((s) => [s.itemId, s])), [stock])
  const nBatches = Math.max(1, parseInt(batches || '1', 10) || 1)

  // Pre-fill actuals with the BOM plan; the supervisor edits what really happened.
  useEffect(() => {
    if (!bom) return
    setActuals(Object.fromEntries(bom.lines.map((l: any) => [l.itemId, fmtQty(l.qtyPerBatch * nBatches, meta.get(l.itemId)?.displayFactor ?? 1)])))
  }, [bom?.id, nBatches, meta.size]) // eslint-disable-line react-hooks/exhaustive-deps

  function pouchesFromOutput() {
    if (!bom) return
    const total = (parseInt(good || '0', 10) || 0) + (parseInt(damaged || '0', 10) || 0)
    const line = bom.lines.find((l: any) => /pouch/i.test(meta.get(l.itemId)?.name ?? ''))
    if (line) setActuals({ ...actuals, [line.itemId]: String(total) })
  }

  async function loadDetail(id: number) {
    setDetail(await api(`/api/production-runs/${id}`))
  }

  async function save() {
    if (!bom) return
    setBusy(true)
    setErr('')
    try {
      const r = await api('/api/production-runs', {
        method: 'POST',
        json: {
          bomId: bom.id,
          batches: nBatches,
          runDate: date,
          actuals: bom.lines.map((l: any) => ({ itemId: l.itemId, qty: actuals[l.itemId] })),
          goodOutput: parseInt(good, 10),
          damagedPackets: parseInt(damaged || '0', 10),
        },
      })
      await reload()
      await loadDetail(r.runId)
    } catch (e: any) {
      setErr(e.message)
    }
    setBusy(false)
  }

  return (
    <>
      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">Log a production run</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <select className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Product</option>
            {withBom.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.packLabel}
              </option>
            ))}
          </select>
          <input className={field} inputMode="numeric" placeholder="Batches" value={batches} onChange={(e) => setBatches(e.target.value.replace(/\D/g, ''))} />
          <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {bom && (
          <>
            <p className="text-sm text-neutral-500">Expected output: {bom.expectedYield * nBatches} packets. Enter what was actually used.</p>
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th>Material</th>
                  <th className="text-right">Planned</th>
                  <th className="w-32 pl-2">Actual</th>
                </tr>
              </thead>
              <tbody>
                {bom.lines.map((l: any) => {
                  const m = meta.get(l.itemId)
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5">{m?.name}</td>
                      <td className="text-right text-neutral-500">
                        {fmtQty(l.qtyPerBatch * nBatches, m?.displayFactor ?? 1)} {m?.displayUnit}
                      </td>
                      <td className="pl-2">
                        <input className={field} inputMode="decimal" value={actuals[l.itemId] ?? ''} onChange={(e) => setActuals({ ...actuals, [l.itemId]: e.target.value })} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                Good packets produced
                <input className={`${field} mt-1`} inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="text-sm">
                Damaged pouches / packets
                <input className={`${field} mt-1`} inputMode="numeric" value={damaged} onChange={(e) => setDamaged(e.target.value.replace(/\D/g, ''))} />
              </label>
              <div className="flex items-end">
                <button className={btnGhost} onClick={pouchesFromOutput}>
                  Pouches = good + damaged
                </button>
              </div>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className={btnPrimary} disabled={busy || !good} onClick={save}>
              Save run
            </button>
          </>
        )}
      </div>

      {detail && <RunDetail d={detail} reload={() => loadDetail(detail.run.id)} />}

      <div className={card}>
        <h2 className="mb-2 font-semibold">Recent runs</h2>
        {runs.length === 0 && <p className="text-sm text-neutral-500">No runs yet.</p>}
        {runs.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t py-2 text-sm first:border-t-0">
            <span>
              {r.runNo} · {r.bom.product.name} {r.bom.product.packLabel} · {r.goodOutput}/{r.expectedOutput} packets
            </span>
            <button className="text-emerald-700 underline" onClick={() => loadDetail(r.id)}>
              View
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

function RunDetail({ d, reload }: { d: any; reload: () => Promise<void> }) {
  const [o, setO] = useState({ labour: '', gas: '', other: '' })
  const [err, setErr] = useState('')
  const pct = (v: string | null) => (v === null ? '-' : `${Number(v) > 0 ? '+' : ''}${v}%`)

  async function saveOverheads() {
    setErr('')
    try {
      const json: Record<string, number> = {}
      if (o.labour) json.labourPaise = rupeesToPaise(o.labour)
      if (o.gas) json.powerGasPaise = rupeesToPaise(o.gas)
      if (o.other) json.otherOverheadPaise = rupeesToPaise(o.other)
      await api(`/api/production-runs/${d.run.id}`, { method: 'PATCH', json })
      await reload()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const c = d.costing
  return (
    <div className={`${card} space-y-3`}>
      <h2 className="font-semibold">
        {d.run.runNo}: planned vs actual
      </h2>
      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th>Item</th>
            <th className="text-right">Planned</th>
            <th className="text-right">Actual</th>
            <th className="text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l: any) => (
            <tr key={l.id} className="border-t">
              <td className="py-1.5">{l.item.name}</td>
              <td className="text-right">{fmtQty(l.plannedQty, l.item.displayFactor)}</td>
              <td className="text-right">{fmtQty(l.actualQty, l.item.displayFactor)}</td>
              <td className={`text-right ${l.flagged ? 'font-medium text-red-700' : ''}`}>
                {pct(l.variancePct)}
                <Flag on={l.flagged} />
              </td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="py-1.5">Yield (packets)</td>
            <td className="text-right">{d.yield.expected}</td>
            <td className="text-right">{d.yield.actual}</td>
            <td className={`text-right ${d.yield.flagged ? 'text-red-700' : ''}`}>
              {pct(d.yield.variancePct)}
              <Flag on={d.yield.flagged} />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Labour (₹)
          <input className={`${field} mt-1`} inputMode="decimal" value={o.labour} onChange={(e) => setO({ ...o, labour: e.target.value })} placeholder={String(d.run.labourPaise / 100)} />
        </label>
        <label className="text-sm">
          Gas / power (₹)
          <input className={`${field} mt-1`} inputMode="decimal" value={o.gas} onChange={(e) => setO({ ...o, gas: e.target.value })} placeholder={String(d.run.powerGasPaise / 100)} />
        </label>
        <label className="text-sm">
          Other (₹)
          <input className={`${field} mt-1`} inputMode="decimal" value={o.other} onChange={(e) => setO({ ...o, other: e.target.value })} placeholder={String(d.run.otherOverheadPaise / 100)} />
        </label>
      </div>
      <button className={btnGhost} onClick={saveOverheads} disabled={!o.labour && !o.gas && !o.other}>
        Save overheads
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="rounded-lg bg-emerald-50 p-3 text-sm">
        <div>Materials {rupees(c.materialPaise)} + overheads {rupees(c.overheadPaise)} = {rupees(c.totalPaise)}</div>
        {c.costPerPacketPaise && (
          <div className="mt-1 text-base font-semibold">
            Cost per packet {rupees(Number(c.costPerPacketPaise))} · margin {rupees(Number(c.marginPerPacketPaise))} ({c.marginPct}%)
          </div>
        )}
        <div className="mt-1 text-xs text-neutral-600">Weighted-average material cost on actual quantities; all overheads spread equally over good packets.</div>
      </div>
    </div>
  )
}
