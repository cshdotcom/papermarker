import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * 用户渲染配置（标记层默认 + 打印默认方案 + 桥接地址 + 自定义 AI 源）：
 * GET  读取 configJson
 * PUT 保存到 configJson（白名单校验，防注入）
 */

function normalizeAiSource(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null
  const clean: Record<string, any> = {}
  clean.enabled = raw.enabled === true
  if (typeof raw.baseUrl === 'string') {
    const u = raw.baseUrl.trim()
    // 校验 URL 合法性（http/https），防止注入非法协议
    if (u && /^https?:\/\/.+/i.test(u)) clean.baseUrl = u.replace(/\/+$/, '')
    else if (u === '') clean.baseUrl = ''
    else return { __invalid: 'baseUrl 必须是 http(s):// 开头的合法地址' }
  }
  if (typeof raw.apiKey === 'string') clean.apiKey = raw.apiKey.trim()
  if (typeof raw.model === 'string') clean.model = raw.model.trim()
  if (typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 2) {
    clean.temperature = raw.temperature
  }
  return clean
}

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let layers: any = {}
  let printDefaults: any = {}
  let bridgeUrl: string = ''
  let aiSource: any = {}
  try {
    const cfg = JSON.parse(u?.configJson || '{}')
    layers = cfg.layers || {}
    printDefaults = cfg.printDefaults || {}
    bridgeUrl = typeof cfg.bridgeUrl === 'string' ? cfg.bridgeUrl : ''
    aiSource = cfg.aiSource || {}
  } catch {}
  // 不回传 apiKey 明文，只回传掩码
  const key = String(aiSource.apiKey || '')
  const apiKeyMasked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : ''
  return NextResponse.json({ code: 200, layers, printDefaults, bridgeUrl, aiSource: { ...aiSource, apiKey: undefined, apiKeyMasked, hasKey: !!key } })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json()
  const { layers, printDefaults, bridgeUrl, aiSource } = body

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

  // 保存桥接地址（http(s) URL，可以为空表示默认 localhost:3790）
  if (typeof bridgeUrl === 'string') {
    const v = bridgeUrl.trim().replace(/\/+$/, '')
    if (v === '') {
      delete cfg.bridgeUrl
    } else if (/^https?:\/\/.+/i.test(v)) {
      cfg.bridgeUrl = v
    } else {
      return NextResponse.json({ code: 400, msg: '桥接地址必须是 http(s):// 开头的合法地址' }, { status: 400 })
    }
  }

  // 保存自定义 AI 源
  if (aiSource && typeof aiSource === 'object') {
    const clean = normalizeAiSource(aiSource)
    if (clean && clean.__invalid) {
      return NextResponse.json({ code: 400, msg: clean.__invalid }, { status: 400 })
    }
    if (clean) {
      // apiKey 特殊处理：空字符串表示不修改已有 key；显式 null/undefined 清除
      if (typeof clean.apiKey === 'string' && clean.apiKey === '') {
        const prev = cfg.aiSource?.apiKey || ''
        clean.apiKey = prev
      }
      cfg.aiSource = clean
    }
  }

  await db.user.update({
    where: { id: auth.uid },
    data: { configJson: JSON.stringify(cfg) },
  })

  const key = String(cfg.aiSource?.apiKey || '')
  return NextResponse.json({
    code: 200,
    msg: '已保存默认设置',
    layers: cfg.layers,
    printDefaults: cfg.printDefaults,
    bridgeUrl: cfg.bridgeUrl || '',
    aiSource: {
      ...(cfg.aiSource || {}),
      apiKey: undefined,
      apiKeyMasked: key ? `${key.slice(0, 4)}****${key.slice(-4)}` : '',
      hasKey: !!key,
    },
  })
}
