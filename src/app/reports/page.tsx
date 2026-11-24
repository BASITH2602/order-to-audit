'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, useUser } from '@/lib/client'
import { Header, btnGhost, btnPrimary, card, field } from '@/components/ui'
import { REPORTS, moneyStr, type Report } from '@/lib/report-catalog'

const istToday = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)

export default function ReportsPage() {
  const user = useUser(['ACCOUNTANT', 'OWNER', 'FACTORY_ADMIN'])
  const today = istToday()
  const [name, setName] = useState<string>(REPORTS[0].name)
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [itemId, setItemId] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const needsItem = REPORTS.find((r) => r.name === name)?.needsItem
  const qs = useCallback((format: string) => {
    const p = new URLSearchParams({ from, to, format })
    if (needsItem && itemId) p.set('itemId', itemId)
    return p.toString()
  }, [from, to, itemId, needsItem])

  useEffect(() => {
    api('/api/stock').then(setItems).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      setReport(await api<Report>(`/api/reports/${name}?${qs('json')}`))
    } catch (e: any) {
      setErr(e.message)
      setReport(null)
    }
    setBusy(false)
  }, [name, qs])

  useEffect(() => {
    void load()
  }, [load])

  const show = (kind: string, v: unknown) => (v === null || v === undefined ? '' : kind === 'money' ? moneyStr(Number(v), true) : String(v))
  const right = (kind: string) => ['money', 'int', 'qty', 'pct'].includes(kind)

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Reports" user={user?.name} />
      <div className="space-y-4 p-4">
        <div className={`${card} grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]`}>
          <select className={field} value={name} onChange={(e) => setName(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r.name} value={r.name}>
                {r.title}
              </option>
            ))}
          </select>
          <label className="text-xs text-neutral-500">
            From
            <input className={`${field} mt-1`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-neutral-500">
            To
            <input className={`${field} mt-1`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="flex items-end">
            <button className={btnPrimary} onClick={load} disabled={busy}>
              {busy ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {needsItem && (
            <select className={`${field} md:col-span-4`} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">All items</option>
              {items.map((i) => (
                <option key={i.itemId} value={i.itemId}>
                  {i.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-500">Export:</span>
          {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([f, label]) => (
            <a key={f} className={btnGhost} href={`/api/reports/${name}?${qs(f)}`}>
              {label}
            </a>
          ))}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        {report && (
          <div className={`${card} overflow-x-auto`}>
            <h2 className="font-semibold">{report.title}</h2>
            <p className="mb-2 text-xs text-neutral-500">{report.subtitle}</p>
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} className={`whitespace-nowrap px-2 py-1 ${right(c.kind) ? 'text-right' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${right(c.kind) ? 'text-right' : ''} ${c.key === 'flag' && r[c.key] ? 'font-medium text-red-700' : ''}`}>
                        {show(c.kind, r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {report.totals && (
                  <tr className="border-t-2 font-semibold">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${right(c.kind) ? 'text-right' : ''}`}>
                        {show(c.kind, report.totals![c.key])}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {report.rows.length === 0 && <p className="py-4 text-sm text-neutral-500">No records in this period.</p>}
            <p className="mt-2 text-xs text-neutral-500">Amounts in ₹.</p>
          </div>
        )}
      </div>
    </div>
  )
}
