import { z } from 'zod'
import { login } from '@/lib/auth'
import { errorResponse } from '@/lib/api'

export async function POST(req: Request) {
  try {
    const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(await req.json())
    const s = await login(username, password)
    return Response.json({ name: s.name, role: s.role })
  } catch (e) {
    return errorResponse(e)
  }
}
