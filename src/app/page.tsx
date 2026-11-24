import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

const HOME = { SALESMAN: '/sales', FACTORY_ADMIN: '/admin', PRODUCTION: '/production', OWNER: '/owner', ACCOUNTANT: '/reports' } as const

export default async function Home() {
  const s = await getSession()
  redirect(s ? HOME[s.role] : '/login')
}
