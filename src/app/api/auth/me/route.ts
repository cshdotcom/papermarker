import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  // 附带用户标记层默认配置（configJson.layers）
  let config: any = {}
  try {
    const u = await db.user.findUnique({ where: { id: auth.uid } })
    config = JSON.parse(u?.configJson || '{}')
  } catch {}
  return NextResponse.json({
    code: 200,
    user: { id: auth.uid, username: auth.username },
    config,
  })
}
