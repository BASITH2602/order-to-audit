'use client'
import { useState } from 'react'
import { api } from '@/lib/client'
import { btnPrimary, field } from '@/components/ui'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api('/api/auth/login', { method: 'POST', json: { username, password } })
      window.location.href = '/'
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold">Order to Audit</h1>
      <p className="mb-6 text-sm text-neutral-500">Sign in to continue</p>
      <form onSubmit={submit} className="space-y-3">
        <input className={field} placeholder="Username" autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className={field} type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className={`${btnPrimary} w-full`} disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
