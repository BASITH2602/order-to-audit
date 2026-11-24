'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, rupees, useEvents, useUser } from '@/lib/client'
import { Header, StatusBadge, card } from '@/components/ui'
import StockTable from '@/components/StockTable'

export default function OwnerPage() {
  const user = useUser(['OWNER', 'ACCOUNTANT'])
  const [orders, setOrders] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [receivables, setReceivables] = useState<any[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [latest, setLatest] = useState<any>(null)

  const reload = useCallback(async () => {
    const [o, s, r, runList] = await Promise.all([api('/api/orders'), api('/api/stock'), api('/api/receivables'), api('/api/production-runs')])
    setOrders(o)
    setStock(s)
    setReceivables(r)
    setRuns(runList)
    if (runList[0]) setLatest(await api(`/api/production-runs/${runList[0].id}`))
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  useEvents(() => void reload())

  const todayStr = new Date().toDateString()
  const todays = orders.filter((o) => new Date(o.createdAt).toDateString() === todayStr)
  const pending = orders.filter((o) => o.status === 'SUBMITTED').length
  const dues = receivables.reduce((s, r) => s + r.outstandingPaise, 0)
  const low = stock.filter((s) => s.low)
  const flaggedLines = latest ? latest.lines.filter((l: any) => l.flagged) : []

  return (
    <div className="mx-auto max-w-5xl">
      <Header title={user?.role === 'ACCOUNTANT' ? 'Accounts (read-only)' : 'Owner summary'} user={user?.name} />
      <div className="space-y-4 p-4">
        <a href="/reports" className="inline-block text-sm text-emerald-700 underline">
          Open monthly reports (sales, GST, stock, production, collections)
        </a>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Orders today" value={String(todays.length)} />
          <Stat label="Awaiting approval" value={String(pending)} />
          <Stat label="Outstanding dues" value={rupees(dues)} />
          <Stat label="Low-stock items" value={String(low.length)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className={card}>
            <h2 className="mb-2 font-semibold">Latest production run</h2>
            {!latest && <p className="text-sm text-neutral-500">No runs yet.</p>}
            {latest && (
              <div className="space-y-1 text-sm">
                <div>
                  {latest.run.runNo}: {latest.yield.actual} of {latest.yield.expected} packets
                  {latest.yield.flagged && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-700">yield {latest.yield.variancePct}%</span>}
                </div>
                {flaggedLines.map((l: any) => (
                  <div key={l.id} className="text-red-700">
                    {l.item.name}: {Number(l.variancePct) > 0 ? '+' : ''}
                    {l.variancePct}% vs plan
                  </div>
                ))}
                {latest.costing.costPerPacketPaise && (
                  <div className="pt-1 font-semibold">
                    Cost per packet {rupees(Number(latest.costing.costPerPacketPaise))} · margin {latest.costing.marginPct}%
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-2 font-semibold">Today&apos;s orders</h2>
            {todays.length === 0 && <p className="text-sm text-neutral-500">None yet.</p>}
            {todays.map((o) => (
              <div key={o.id} className="flex items-center justify-between border-t py-1.5 text-sm first:border-t-0">
                <span>
                  #{o.id} · {o.customer.name}
                </span>
                <StatusBadge status={o.status} />
              </div>
            ))}
          </div>
        </div>

        <h2 className="font-semibold">Stock levels</h2>
        <StockTable rows={stock} />

        <div className={card}>
          <h2 className="mb-2 font-semibold">Outstanding by customer</h2>
          {receivables.length === 0 && <p className="text-sm text-neutral-500">Nothing outstanding.</p>}
          {receivables.map((r) => (
            <div key={r.customerId} className="flex justify-between border-t py-1.5 text-sm first:border-t-0">
              <span>{r.name}</span>
              <span className="font-medium">{rupees(r.outstandingPaise)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={card}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
