import { NextRequest, NextResponse } from 'next/server'
import { authGuard, hashPassword } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * 修改密码（登录后）：
 * 校验旧密码 → 更新 passwordHash。
 */
export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp

  const { oldPassword, newPassword } = await req.json()
  const oldPw = String(oldPassword || '')
  const newPw = String(newPassword || '')

  if (!oldPw || !newPw) {
    return NextResponse.json({ code: 400, msg: '请填写旧密码和新密码' }, { status: 400 })
  }
  if (newPw.length < 6) {
    return NextResponse.json({ code: 400, msg: '新密码至少 6 位' }, { status: 400 })
  }

  const u = await db.user.findUnique({ where: { id: auth.uid } })
  if (!u) {
    return NextResponse.json({ code: 404, msg: '用户不存在' }, { status: 404 })
  }
  if (u.passwordHash !== hashPassword(oldPw)) {
    return NextResponse.json({ code: 401, msg: '旧密码不正确' }, { status: 401 })
  }
  if (u.passwordHash === hashPassword(newPw)) {
    return NextResponse.json({ code: 400, msg: '新密码不能与旧密码相同' }, { status: 400 })
  }

  await db.user.update({
    where: { id: auth.uid },
    data: { passwordHash: hashPassword(newPw) },
  })

  return NextResponse.json({ code: 200, msg: '密码已修改，下次登录请使用新密码' })
}
