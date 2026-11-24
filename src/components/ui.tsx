'use client'
import { api } from '@/lib/client'

export const btn = 'rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50'
export const btnPrimary = `${btn} bg-emerald-700 text-white hover:bg-emerald-800`
export const btnGhost = `${btn} border border-neutral-300 bg-white hover:bg-neutral-100`
export const btnDanger = `${btn} bg-red-600 text-white hover:bg-red-700`
export const field = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm'
export const card = 'rounded-xl border border-neutral-200 bg-white p-4 shadow-sm'

const colors: Record<string, string> = {
  SUBMITTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  INVOICED: 'bg-indigo-100 text-indigo-800',
  DISPATCHED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-neutral-100'}`}>{status.toLowerCase()}</span>
}

export function Header({ title, user }: { title: string; user?: string }) {
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div>
        <h1 className="text-base font-semibold">{title}</h1>
        {user && <p className="text-xs text-neutral-500">{user}</p>}
      </div>
      <button onClick={logout} className="text-sm text-neutral-600 underline">
        Sign out
      </button>
    </header>
  )
}

export function Flag({ on }: { on: boolean }) {
  return on ? <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">flagged</span> : null
}
