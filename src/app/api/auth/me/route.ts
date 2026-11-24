import { getSession } from '@/lib/auth'

export async function GET() {
  const s = await getSession()
  return s ? Response.json(s) : Response.json({ error: 'Not signed in' }, { status: 401 })
}
