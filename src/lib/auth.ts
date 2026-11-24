/**
 * Authentication and role checks.
 * Session = signed JWT in an httpOnly, sameSite=lax cookie. The user's role and active flag are
 * re-checked against the database on every request, so a disabled account or changed role takes effect at once.
 */
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import type { Role } from '@prisma/client'
import { prisma } from './db'
import { HttpError } from './errors'

const COOKIE = 'ota_session'
const MAX_AGE_S = 12 * 3600

export type Session = { userId: number; role: Role; name: string }

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET (at least 32 characters) is required')
  return new TextEncoder().encode(s)
}

// ---- login throttle: 5 failures per username -> 15 minute lock (in-memory; single instance) ----
const failures = new Map<string, { n: number; until: number }>()
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10) // equalises timing for unknown usernames

export async function login(username: string, password: string): Promise<Session> {
  const f = failures.get(username)
  if (f && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again later.')

  const user = await prisma.user.findUnique({ where: { username } })
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !user.active || !ok) {
    const n = (f?.n ?? 0) + 1
    failures.set(username, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 })
    throw new HttpError(401, 'Invalid username or password')
  }
  failures.delete(username)

  const session: Session = { userId: user.id, role: user.role, name: user.name }
  const token = await new SignJWT({ role: user.role, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key())
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Set COOKIE_SECURE=false only when serving over plain http (e.g. phone testing on a LAN)
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  })
  return session
}

export async function logout() {
  ;(await cookies()).delete(COOKIE)
}

/** Current user from the cookie, verified against the database. Null if not signed in. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key())
    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      select: { id: true, role: true, name: true, active: true },
    })
    if (!user || !user.active) return null
    return { userId: user.id, role: user.role, name: user.name }
  } catch {
    return null
  }
}

export async function requireRole(roles: Role[]): Promise<Session> {
  const s = await getSession()
  if (!s) throw new HttpError(401, 'Not signed in')
  if (!roles.includes(s.role)) throw new HttpError(403, 'Your role cannot do this')
  return s
}
