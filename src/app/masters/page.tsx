'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, fmtQty, rupees, rupeesToPaise, useUser } from '@/lib/client'
import { Header, btnGhost, btnPrimary, card, field } from '@/components/ui'
import { GST_STATES } from '@/lib/gst-states'
import { isValidGstin } from '@/lib/gstin'

type Tab = 'items' | 'products' | 'customers' | 'users' | 'stock'
const TABS: [Tab, string][] = [['items', 'Materials'], ['products', 'Products & recipes'], ['customers', 'Customers'], ['users', 'Users'], ['stock', 'Opening / adjust stock']]

export default function MastersPage() {
  const user = useUser(['FACTORY_ADMIN'])
  const [tab, setTab] = useState<Tab>('items')
  const [items, setItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])

  const reload = useCallback(async () => {
    const [i, p, c, u, s] = await Promise.all([api('/api/masters/items'), api('/api/products'), api('/api/customers'), api('/api/masters/users'), api('/api/stock')])
    setItems(i)
    setProducts(p)
    setCustomers(c)
    setUsers(u)
    setStock(s)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="mx-auto max-w-4xl">
      <Header title="Master data" user={user?.name} />
      <nav className="flex flex-wrap gap-2 border-b bg-white px-4 py-2">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-emerald-700 text-white' : 'hover:bg-neutral-100'}`}>
            {label}
          </button>
        ))}
        <a href="/admin" className="ml-auto rounded-lg px-3 py-1.5 text-sm text-emerald-700 hover:bg-neutral-100">
          Back to desk
        </a>
      </nav>
      <div className="space-y-4 p-4">
        {tab === 'items' && <ItemsTab items={items} reload={reload} />}
        {tab === 'products' && <ProductsTab products={products} items={items} reload={reload} />}
        {tab === 'customers' && <CustomersTab customers={customers} reload={reload} />}
        {tab === 'users' && <UsersTab users={users} me={user?.name} reload={reload} />}
        {tab === 'stock' && <StockTab stock={stock} reload={reload} />}
      </div>
    </div>
  )
}

function useAction(reload: () => Promise<void>) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okText = 'Saved.') => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, t: okText })
      await reload()
      return true
    } catch (e: any) {
      setMsg({ ok: false, t: e.data?.issues ? e.data.issues.map((i: any) => i.message).join('; ') : e.message })
      return false
    } finally {
      setBusy(false)
    }
  }
  const note = msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</p>
  return { run, busy, note }
}

const Label = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <label className="block text-xs text-neutral-500">
    {t}
    <div className="mt-1 text-sm text-neutral-900">{children}</div>
  </label>
)

// ---------------- Materials ----------------
function ItemsTab({ items, reload }: { items: any[]; reload: () => Promise<void> }) {
  const { run, busy, note } = useAction(reload)
  const [f, setF] = useState({ name: '', kind: 'RAW', unit: 'kg', reorder: '' })
  return (
    <>
      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">Add raw or packaging material</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input className={field} placeholder="Name (e.g. Rice flour)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="RAW">Raw material</option>
            <option value="PACKAGING">Packaging</option>
          </select>
          <select className={field} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {['kg', 'g', 'L', 'ml', 'pcs'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <input className={field} inputMode="decimal" placeholder={`Reorder level (${f.unit})`} value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value })} />
        </div>
        <button
          className={btnPrimary}
          disabled={busy || f.name.trim().length < 2}
          onClick={async () => {
            if (await run(() => api('/api/masters/items', { method: 'POST', json: { name: f.name, kind: f.kind, unit: f.unit, reorderLevel: f.reorder || undefined } }), 'Material added.')) setF({ ...f, name: '', reorder: '' })
          }}
        >
          Add material
        </button>
        {note}
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Unit</th>
              <th className="text-right">Reorder level</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="py-1.5">{i.name}</td>
                <td className="text-neutral-500">{i.kind.toLowerCase()}</td>
                <td>{i.displayUnit}</td>
                <td className="text-right">{i.reorderLevel != null ? fmtQty(i.reorderLevel, i.displayFactor) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------- Products & recipes ----------------
function ProductsTab({ products, items, reload }: { products: any[]; items: any[]; reload: () => Promise<void> }) {
  const { run, busy, note } = useAction(reload)
  const [f, setF] = useState({ name: '', pack: '', hsn: '', gst: '5', price: '', carton: '20', copy: '' })
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [bomFor, setBomFor] = useState('')
  const [yieldQty, setYieldQty] = useState('')
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([])
  const ingredients = items.filter((i) => i.kind !== 'FINISHED')
  const product = products.find((p) => String(p.id) === bomFor)
  const bom = product?.boms?.[0]

  useEffect(() => {
    if (!product) return
    const b = product.boms?.[0]
    setYieldQty(b ? String(b.expectedYield) : '')
    setLines(b ? b.lines.map((l: any) => ({ itemId: String(l.itemId), qty: fmtQty(l.qtyPerBatch, items.find((i) => i.id === l.itemId)?.displayFactor ?? 1) })) : [{ itemId: '', qty: '' }])
  }, [bomFor, product?.boms?.[0]?.id, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const createProduct = () =>
    run(
      () =>
        api('/api/masters/products', {
          method: 'POST',
          json: {
            name: f.name,
            packLabel: f.pack,
            hsn: f.hsn,
            gstRatePct: Number(f.gst),
            pricePaise: rupeesToPaise(f.price),
            packetsPerCarton: Number(f.carton),
            copyBomFromProductId: f.copy ? Number(f.copy) : undefined,
          },
        }),
      'Product created.',
    )

  const saveBom = () =>
    run(
      () => {
        const body = { expectedYield: Number(yieldQty), lines: lines.map((l) => ({ itemId: Number(l.itemId), qty: l.qty })) }
        return bom ? api(`/api/masters/boms/${bom.id}`, { method: 'PUT', json: body }) : api('/api/masters/boms', { method: 'POST', json: { productId: product.id, ...body } })
      },
      'Recipe saved.',
    )

  return (
    <>
      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">Add product / pack size</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={field} placeholder="Name (e.g. Murukku)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={field} placeholder="Pack size (e.g. 500 g)" value={f.pack} onChange={(e) => setF({ ...f, pack: e.target.value })} />
          <input className={field} inputMode="numeric" placeholder="HSN code" value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} />
          <input className={field} inputMode="numeric" placeholder="GST %" value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })} />
          <input className={field} inputMode="decimal" placeholder="Price per packet ₹ (before tax)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <input className={field} inputMode="numeric" placeholder="Packets per carton" value={f.carton} onChange={(e) => setF({ ...f, carton: e.target.value })} />
        </div>
        <select className={field} value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })}>
          <option value="">Start with an empty recipe</option>
          {products.filter((p) => p.boms?.length).map((p) => (
            <option key={p.id} value={p.id}>
              Copy recipe from {p.name} {p.packLabel}
            </option>
          ))}
        </select>
        <button className={btnPrimary} disabled={busy || !f.name || !f.pack || !f.hsn || !f.price} onClick={createProduct}>
          Create product
        </button>
        {note}
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold">Products and list prices</h2>
        {products.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0">
            <span>
              {p.name} {p.packLabel} · HSN {p.hsn} · GST {p.gstRatePct}% · {rupees(p.pricePaise)}
            </span>
            <span className="flex gap-2">
              <input className={`${field} w-28`} inputMode="decimal" placeholder="New price ₹" value={prices[p.id] ?? ''} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} />
              <button
                className={btnGhost}
                disabled={busy || !prices[p.id]}
                onClick={() => run(() => api(`/api/masters/products/${p.id}`, { method: 'PATCH', json: { pricePaise: rupeesToPaise(prices[p.id]) } }), 'Price updated for new orders.')}
              >
                Update price
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">Recipe (BOM) per batch</h2>
        <select className={field} value={bomFor} onChange={(e) => setBomFor(e.target.value)}>
          <option value="">Choose product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.packLabel} {p.boms?.length ? '' : '(no recipe yet)'}
            </option>
          ))}
        </select>
        {product && (
          <>
            <Label t="Expected output per batch (packets)">
              <input className={field} inputMode="numeric" value={yieldQty} onChange={(e) => setYieldQty(e.target.value.replace(/\D/g, ''))} />
            </Label>
            {lines.map((l, i) => {
              const unit = items.find((x) => String(x.id) === l.itemId)?.displayUnit
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                  <select className={field} value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                    <option value="">Material</option>
                    {ingredients.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                  <input className={field} inputMode="decimal" placeholder={`Qty per batch${unit ? ` (${unit})` : ''}`} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <button className={btnGhost} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              )
            })}
            <div className="flex gap-2">
              <button className={btnGhost} onClick={() => setLines([...lines, { itemId: '', qty: '' }])}>
                Add material
              </button>
              <button className={btnPrimary} disabled={busy || !yieldQty || lines.length === 0 || lines.some((l) => !l.itemId || !l.qty)} onClick={saveBom}>
                Save recipe
              </button>
            </div>
            <p className="text-xs text-neutral-500">Changing a recipe affects new production runs only. Saved runs keep the plan they were logged with.</p>
          </>
        )}
      </div>
    </>
  )
}

// ---------------- Customers ----------------
function CustomersTab({ customers, reload }: { customers: any[]; reload: () => Promise<void> }) {
  const { run, busy, note } = useAction(reload)
  const blank = { id: 0, name: '', type: 'RETAILER', stateCode: '33', gstin: '' }
  const [f, setF] = useState(blank)
  const g = f.gstin.trim().toUpperCase()
  const gstinMsg = !g ? '' : !isValidGstin(g) ? 'Not a valid GSTIN' : g.slice(0, 2) !== f.stateCode ? 'GSTIN state does not match the selected state' : 'GSTIN looks valid'

  return (
    <>
      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">{f.id ? 'Edit customer' : 'Add customer'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={field} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={field} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="RETAILER">Retailer</option>
            <option value="DISTRIBUTOR">Distributor</option>
          </select>
          <select className={field} value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          <input className={field} placeholder="GSTIN (leave empty if unregistered)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} />
        </div>
        {gstinMsg && <p className={`text-xs ${gstinMsg.includes('looks') ? 'text-emerald-700' : 'text-red-600'}`}>{gstinMsg}</p>}
        <div className="flex gap-2">
          <button
            className={btnPrimary}
            disabled={busy || f.name.trim().length < 2}
            onClick={async () => {
              const body = { name: f.name, type: f.type, stateCode: f.stateCode, gstin: g }
              if (await run(() => (f.id ? api(`/api/masters/customers/${f.id}`, { method: 'PATCH', json: body }) : api('/api/masters/customers', { method: 'POST', json: body })), 'Customer saved.')) setF(blank)
            }}
          >
            {f.id ? 'Save changes' : 'Add customer'}
          </button>
          {f.id !== 0 && (
            <button className={btnGhost} onClick={() => setF(blank)}>
              Cancel
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500">The state decides CGST+SGST (same state as the factory) or IGST (other states).</p>
        {note}
      </div>
      <div className={card}>
        {customers.map((c) => (
          <div key={c.id} className="flex items-center justify-between border-t py-2 text-sm first:border-t-0">
            <span>
              {c.name} · {c.type.toLowerCase()} · {c.stateName} · {c.gstin ?? 'unregistered'}
            </span>
            <button className="text-emerald-700 underline" onClick={() => setF({ id: c.id, name: c.name, type: c.type, stateCode: c.stateCode, gstin: c.gstin ?? '' })}>
              Edit
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------- Users ----------------
const ROLES = ['SALESMAN', 'FACTORY_ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER']

function UsersTab({ users, me, reload }: { users: any[]; me?: string; reload: () => Promise<void> }) {
  const { run, busy, note } = useAction(reload)
  const [f, setF] = useState({ username: '', name: '', role: 'SALESMAN', password: '' })
  return (
    <>
      <div className={`${card} space-y-3`}>
        <h2 className="font-semibold">Add user</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={field} placeholder="Username (lowercase)" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <input className={field} placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={field} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <input className={field} type="password" placeholder="Password (12+ characters)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <button
          className={btnPrimary}
          disabled={busy || !f.username || !f.name || f.password.length < 12}
          onClick={async () => {
            if (await run(() => api('/api/masters/users', { method: 'POST', json: f }), 'User created.')) setF({ username: '', name: '', role: 'SALESMAN', password: '' })
          }}
        >
          Create user
        </button>
        {note}
      </div>
      <div className={card}>
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0">
            <span className={u.active ? '' : 'text-neutral-400 line-through'}>
              {u.name} ({u.username}){u.name === me ? ' · you' : ''}
            </span>
            <span className="flex flex-wrap gap-2">
              <select className={`${field} w-40`} value={u.role} disabled={u.name === me} onChange={(e) => run(() => api(`/api/masters/users/${u.id}`, { method: 'PATCH', json: { role: e.target.value } }), 'Role changed.')}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                className={btnGhost}
                onClick={() => {
                  const password = window.prompt(`New password for ${u.username} (12+ characters)`)
                  if (password) void run(() => api(`/api/masters/users/${u.id}`, { method: 'PATCH', json: { password } }), 'Password changed.')
                }}
              >
                Reset password
              </button>
              {u.name !== me && (
                <button className={btnGhost} onClick={() => run(() => api(`/api/masters/users/${u.id}`, { method: 'PATCH', json: { active: !u.active } }), u.active ? 'User deactivated.' : 'User activated.')}>
                  {u.active ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------- Opening balances & adjustments ----------------
function StockTab({ stock, reload }: { stock: any[]; reload: () => Promise<void> }) {
  const { run, busy, note } = useAction(reload)
  const [f, setF] = useState({ mode: 'OPENING', itemId: '', qty: '', rate: '', reason: '' })
  const item = stock.find((s) => String(s.itemId) === f.itemId)
  return (
    <div className={`${card} space-y-3`}>
      <h2 className="font-semibold">Opening balance or stock adjustment</h2>
      <p className="text-sm text-neutral-500">Opening: the first balance for an item that has no history. Adjustment: a stock-take correction (use a minus sign to remove stock). Every entry is logged with your name and reason.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select className={field} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          <option value="OPENING">Opening balance</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
        <select className={field} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          <option value="">Item</option>
          {stock.map((s) => (
            <option key={s.itemId} value={s.itemId}>
              {s.name}
            </option>
          ))}
        </select>
        <input className={field} inputMode="decimal" placeholder={`Quantity${item ? ` (${item.displayUnit})` : ''}`} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        <input className={field} inputMode="decimal" placeholder={`Rate ₹${item ? ` per ${item.displayUnit}` : ''}${f.mode === 'ADJUSTMENT' ? ' (optional)' : ''}`} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
      </div>
      <input className={field} placeholder="Reason (e.g. Opening stock as on 1 April)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      {item && (
        <p className="text-sm text-neutral-500">
          Current balance: {item.displayQty} {item.displayUnit}
        </p>
      )}
      <button
        className={btnPrimary}
        disabled={busy || !f.itemId || !f.qty || !f.reason || (f.mode === 'OPENING' && !f.rate)}
        onClick={async () => {
          const json = { mode: f.mode, itemId: Number(f.itemId), qty: f.qty.trim(), ratePaise: f.rate ? rupeesToPaise(f.rate) : undefined, reason: f.reason }
          if (await run(() => api('/api/stock/adjustments', { method: 'POST', json }), 'Stock updated.')) setF({ ...f, qty: '', rate: '', reason: '' })
        }}
      >
        Save
      </button>
      {note}
    </div>
  )
}
