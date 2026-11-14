import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureDemoUser, hashPassword, signToken, TOKEN_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  await ensureDemoUser()

  const u = await db.user.findUnique({ where: { username: username || 'teacher' } })
  if (!u || u.passwordHash !== hashPassword(password || '')) {
    return NextResponse.json({ code: 401, msg: '账号或密码错误' }, { status: 401 })
  }

  await db.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } })

  const token = await signToken(u.id, u.username)
  const res = NextResponse.json({
    code: 200,
    msg: '登录成功',
    token,
    user: { id: u.id, username: u.username },
  })
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
