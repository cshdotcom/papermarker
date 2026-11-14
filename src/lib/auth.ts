import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { db } from './db'
import crypto from 'crypto'

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'papermarker-secret-2026-dev'
)
const TOKEN_COOKIE = 'pm_token'
const TOKEN_TTL = '7d'

export function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw + '::pm').digest('hex')
}

export async function signToken(uid: string, username: string): Promise<string> {
  return await new SignJWT({ uid, username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(SECRET)
}

export async function verifyToken(token?: string): Promise<{ uid: string; username: string } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return { uid: payload.uid as string, username: payload.username as string }
  } catch {
    return null
  }
}

/** 确保默认 demo 用户存在，并返回其 id */
export async function ensureDemoUser(): Promise<{ id: string; username: string }> {
  let u = await db.user.findUnique({ where: { username: 'teacher' } })
  if (!u) {
    u = await db.user.create({
      data: {
        username: 'teacher',
        passwordHash: hashPassword('papermarker'),
        apiKey: crypto.randomBytes(16).toString('hex'),
      },
    })
  }
  return { id: u.id, username: u.username }
}

export async function getTokenFromReq(req: NextRequest): Promise<string | undefined> {
  // 1. query 参数 token（img/window.open 等无法带 Header 的场景）
  const qToken = req.nextUrl.searchParams.get('token')
  if (qToken) return qToken
  // 2. cookie
  const cookie = req.cookies.get(TOKEN_COOKIE)?.value
  if (cookie) return cookie
  // 3. Authorization header
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  return undefined
}

export type AuthGuardOk = {
  ok: true
  uid: string
  username: string
}
export type AuthGuardFail = { ok: false; resp: NextResponse }

export async function authGuard(req: NextRequest): Promise<AuthGuardOk | AuthGuardFail> {
  // 0. API Key 应用连接（Android APP / 第三方应用）：X-API-Key 头 或 ?apiKey= 查询参数
  const apiKey =
    req.headers.get('x-api-key') || req.nextUrl.searchParams.get('apiKey') || undefined
  if (apiKey) {
    const token = await db.apiToken.findUnique({
      where: { key: apiKey },
      include: { user: true },
    })
    if (token && token.enabled && token.user) {
      // 延迟 lastUsedAt（不阻塞请求）
      db.apiToken
        .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {})
      return { ok: true, uid: token.user.id, username: token.user.username }
    }
    return {
      ok: false,
      resp: NextResponse.json({ code: 401, msg: 'API Key 无效或已被禁用' }, { status: 401 }),
    }
  }

  const token = await getTokenFromReq(req)
  const payload = await verifyToken(token)
  if (payload) {
    // 延迟 lastLoginAt
    await db.user.update({
      where: { id: payload.uid },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})
    return { ok: true, uid: payload.uid, username: payload.username }
  }
  return {
    ok: false,
    resp: NextResponse.json({ code: 401, msg: '未登录或登录已过期' }, { status: 401 }),
  }
}

export { TOKEN_COOKIE, TOKEN_TTL }
