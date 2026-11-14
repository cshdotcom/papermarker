import { NextRequest, NextResponse } from 'next/server'
import { authGuard, hashPassword, signToken, TOKEN_COOKIE } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * 修改用户名（登录后）：
 * 校验唯一性 + 密码 → 更新 username → 签发携带新用户名的 token（前端静默换 token）。
 */
export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp

  const { username, password } = await req.json()
  const name = String(username || '').trim()
  const pw = String(password || '')

  if (!name || name.length < 2 || name.length > 20) {
    return NextResponse.json({ code: 400, msg: '用户名需 2~20 个字符' }, { status: 400 })
  }
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(name)) {
    return NextResponse.json(
      { code: 400, msg: '用户名仅支持中英文、数字、下划线、点、横线' },
      { status: 400 }
    )
  }

  const u = await db.user.findUnique({ where: { id: auth.uid } })
  if (!u) {
    return NextResponse.json({ code: 404, msg: '用户不存在' }, { status: 404 })
  }
  // 改名需验证密码（账号安全）
  if (u.passwordHash !== hashPassword(pw)) {
    return NextResponse.json({ code: 401, msg: '密码不正确' }, { status: 401 })
  }
  if (name === u.username) {
    return NextResponse.json({ code: 400, msg: '新用户名与当前相同' }, { status: 400 })
  }
  const exists = await db.user.findUnique({ where: { username: name } })
  if (exists) {
    return NextResponse.json({ code: 409, msg: '该用户名已被占用' }, { status: 409 })
  }

  await db.user.update({ where: { id: auth.uid }, data: { username: name } })

  // 签发新 token（携带新用户名），前端替换本地存储
  const token = await signToken(auth.uid, name)
  const res = NextResponse.json({ code: 200, msg: '用户名已修改', username: name, token })
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: false,
    path: '/',
    maxAge: 7 * 24 * 3600,
    sameSite: 'lax',
  })
  return res
}
