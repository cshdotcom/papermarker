import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import crypto from 'crypto'

export const runtime = 'nodejs'

function genKey(): string {
  return 'pmk_' + crypto.randomBytes(24).toString('hex')
}

function maskKey(key: string): string {
  if (key.length <= 12) return key
  return key.slice(0, 8) + '…' + key.slice(-4)
}

/** 列出当前用户的全部应用连接 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const tokens = await db.apiToken.findMany({
    where: { userId: auth.uid },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    code: 200,
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      keyMasked: maskKey(t.key),
      enabled: t.enabled,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
    })),
  })
}

/** 创建应用连接（返回完整 Key，仅此一次可见） */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim().slice(0, 30) || '未命名应用'
  const key = genKey()
  const t = await db.apiToken.create({
    data: { userId: auth.uid, name, key },
  })
  return NextResponse.json({
    code: 200,
    msg: '创建成功，请立即复制保存，完整 Key 仅显示这一次',
    token: {
      id: t.id,
      name: t.name,
      key, // 完整 key，仅创建时返回
      enabled: t.enabled,
      createdAt: t.createdAt,
    },
  })
}

/** 吊销 / 启停应用连接：{ id, action: 'revoke' | 'disable' | 'enable' } */
export async function PATCH(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { id, action } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ code: 400, msg: '缺少 id' }, { status: 400 })
  const t = await db.apiToken.findUnique({ where: { id } })
  if (!t || t.userId !== auth.uid) {
    return NextResponse.json({ code: 404, msg: '应用连接不存在' }, { status: 404 })
  }
  if (action === 'revoke') {
    await db.apiToken.delete({ where: { id } })
    return NextResponse.json({ code: 200, msg: '已吊销该应用连接' })
  }
  if (action === 'disable' || action === 'enable') {
    await db.apiToken.update({ where: { id }, data: { enabled: action === 'enable' } })
    return NextResponse.json({ code: 200, msg: action === 'enable' ? '已启用' : '已停用' })
  }
  return NextResponse.json({ code: 400, msg: '未知操作' }, { status: 400 })
}
