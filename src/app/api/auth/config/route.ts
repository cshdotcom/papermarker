import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * 用户渲染配置（标记层默认 + 打印默认方案）：
 * GET  读取 configJson.layers + configJson.printDefaults
 * PUT 保存 layers / printDefaults 到 configJson
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let layers: any = {}
  let printDefaults: any = {}
  try {
    const cfg = JSON.parse(u?.configJson || '{}')
    layers = cfg.layers || {}
    printDefaults = cfg.printDefaults || {}
  } catch {}
  return NextResponse.json({ code: 200, layers, printDefaults })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json()
  const { layers, printDefaults } = body

  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let cfg: any = {}
  try {
    cfg = JSON.parse(u?.configJson || '{}')
  } catch {}

  // 保存标记层默认（仅保留布尔键，防注入）
  if (layers && typeof layers === 'object') {
    const clean: Record<string, boolean> = {}
    for (const k of ['marks', 'scores', 'answers', 'reason', 'solution', 'boxes', 'banner']) {
      if (typeof layers[k] === 'boolean') clean[k] = layers[k]
    }
    cfg.layers = clean
  }

  // 保存打印默认方案
  if (printDefaults && typeof printDefaults === 'object') {
    const cleanPrint: Record<string, any> = {}
    // method: ipp | brother
    if (['ipp', 'brother'].includes(printDefaults.method)) {
      cleanPrint.method = printDefaults.method
    }
    // content: mark | marks | answer | parse
    if (['mark', 'marks', 'answer', 'parse'].includes(printDefaults.content)) {
      cleanPrint.content = printDefaults.content
    }
    // copies: 1-20
    if (typeof printDefaults.copies === 'number' && printDefaults.copies >= 1 && printDefaults.copies <= 20) {
      cleanPrint.copies = printDefaults.copies
    }
    // duplex: boolean
    if (typeof printDefaults.duplex === 'boolean') {
      cleanPrint.duplex = printDefaults.duplex
    }
    cfg.printDefaults = cleanPrint
  }

  await db.user.update({
    where: { id: auth.uid },
    data: { configJson: JSON.stringify(cfg) },
  })

  return NextResponse.json({
    code: 200,
    msg: '已保存默认设置',
    layers: cfg.layers,
    printDefaults: cfg.printDefaults,
  })
}
