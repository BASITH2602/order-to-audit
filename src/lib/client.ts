'use client'
import { useEffect, useRef, useState } from 'react'

/** fetch wrapper: JSON in/out, throws Error with .status and .data. Network failures have no .status. */
export async function api<T = any>(path: string, init: Omit<RequestInit, 'body'> & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth')) window.location.href = '/login'
    throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status, data })
  }
  return data as T
}

/** Display only. Money is integer paise everywhere else. */
export const rupees = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "50" or "50.25" -> paise, with no floating point. */
export function rupeesToPaise(s: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim())
  if (!m) throw new Error('Enter an amount like 50 or 50.25')
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** base units -> display string (display only), e.g. 10500, 1000 -> "10.5" */
export function fmtQty(base: number, factor: number): string {
  if (factor === 1) return String(base)
  return String(Number((base / factor).toFixed(Math.round(Math.log10(factor)))))
}

/** Subscribe to live server events (orders, stock, payments, alerts). Reconnects on its own. */
export function useEvents(handler: (channel: string, payload: any) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const es = new EventSource('/api/events')
    for (const ch of ['orders', 'stock', 'payments', 'alerts']) {
      es.addEventListener(ch, (e) => {
        try {
          ref.current(ch, JSON.parse((e as MessageEvent).data))
        } catch {}
      })
    }
    return () => es.close()
  }, [])
}

/** Redirects away if the signed-in role is not allowed on this page. Offline: returns null and the page still renders. */
export function useUser(allowed: string[]) {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null)
  useEffect(() => {
    api('/api/auth/me')
      .then((u) => {
        if (!allowed.includes(u.role)) window.location.href = '/'
        else setUser(u)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return user
}
