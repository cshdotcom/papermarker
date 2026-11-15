import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { loadAiSource } from '@/lib/ai-gateway'

export const runtime = 'nodejs'

/**
 * 自定义 AI 源配置（存于 User.configJson.aiSource，OpenAI 兼容接口）：
 * GET  读取（apiKey 只回传掩码）
 * PUT  保存（enabled/baseUrl/apiKey/model/temperature）
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let aiSource: any = {}
  try {
    aiSource = JSON.parse(u?.configJson || '{}')?.aiSource || {}
  } catch {}
  const key = String(aiSource.apiKey || '')
  return NextResponse.json({
    code: 200,
    aiSource: {
      enabled: aiSource.enabled === true,
      baseUrl: String(aiSource.baseUrl || ''),
      model: String(aiSource.model || ''),
      temperature: typeof aiSource.temperature === 'number' ? aiSource.temperature : null,
      apiKeyMasked: key ? `${key.slice(0, 4)}****${key.slice(-4)}` : '',
      hasKey: !!key,
    },
  })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json()
  const { aiSource } = body
  if (!aiSource || typeof aiSource !== 'object') {
    return NextResponse.json({ code: 400, msg: '缺少 aiSource 参数' }, { status: 400 })
  }

  const clean: Record<string, any> = {}
  clean.enabled = aiSource.enabled === true

  const baseUrl = String(aiSource.baseUrl || '').trim().replace(/\/+$/, '')
  if (baseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    return NextResponse.json(
      { code: 400, msg: '接口地址必须是 http(s):// 开头的合法 URL（如 https://api.openai.com/v1）' },
      { status: 400 }
    )
  }
  clean.baseUrl = baseUrl
  clean.model = String(aiSource.model || '').trim()
  if (typeof aiSource.temperature === 'number' && aiSource.temperature >= 0 && aiSource.temperature <= 2) {
    clean.temperature = aiSource.temperature
  }

  // apiKey：留空 = 不修改已有 key；传 null 或 'clear' 清除
  const rawKey = aiSource.apiKey
  const u = await db.user.findUnique({ where: { id: auth.uid } })
  let cfg: any = {}
  try {
    cfg = JSON.parse(u?.configJson || '{}')
  } catch {}
  const prevKey = String(cfg?.aiSource?.apiKey || '')
  if (rawKey === null || rawKey === 'clear') {
    clean.apiKey = ''
  } else if (typeof rawKey === 'string' && rawKey.trim() !== '') {
    clean.apiKey = rawKey.trim()
  } else {
    clean.apiKey = prevKey
  }

  // 开启时校验完整性
  if (clean.enabled) {
    const missing: string[] = []
    if (!clean.baseUrl) missing.push('接口地址')
    if (!clean.apiKey) missing.push('API Key')
    if (!clean.model) missing.push('模型名称')
    if (missing.length > 0) {
      return NextResponse.json(
        { code: 400, msg: `启用自定义 AI 源前请先填写：${missing.join('、')}` },
        { status: 400 }
      )
    }
  }

  cfg.aiSource = clean
  await db.user.update({
    where: { id: auth.uid },
    data: { configJson: JSON.stringify(cfg) },
  })

  const key = String(clean.apiKey || '')
  return NextResponse.json({
    code: 200,
    msg: 'AI 源配置已保存',
    aiSource: {
      enabled: clean.enabled,
      baseUrl: clean.baseUrl,
      model: clean.model,
      temperature: clean.temperature ?? null,
      apiKeyMasked: key ? `${key.slice(0, 4)}****${key.slice(-4)}` : '',
      hasKey: !!key,
    },
  })
}
