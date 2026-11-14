import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * 用户渲染配置（标记层默认开关）：
 * GET  读取 configJson.layers
 * PUT 保存 layers 到 configJson（前端「设置 → 标记层默认」调用）
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let layers: any = {}
  try {
    layers = JSON.parse(u?.configJson || '{}').layers || {}
  } catch {}
  return NextResponse.json({ code: 200, layers })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { layers } = await req.json()
  if (!layers || typeof layers !== 'object') {
    return NextResponse.json({ code: 400, msg: 'layers 参数无效' }, { status: 400 })
  }
  // 仅保留布尔键，防注入
  const clean: Record<string, boolean> = {}
  for (const k of ['marks', 'scores', 'answers', 'reason', 'solution', 'boxes', 'banner']) {
    if (typeof layers[k] === 'boolean') clean[k] = layers[k]
  }
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let cfg: any = {}
  try {
    cfg = JSON.parse(u?.configJson || '{}')
  } catch {}
  cfg.layers = clean
  await db.user.update({
    where: { id: auth.uid },
    data: { configJson: JSON.stringify(cfg) },
  })
  return NextResponse.json({ code: 200, msg: '已保存标记层默认设置', layers: clean })
}
