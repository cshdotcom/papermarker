import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { probePrinter } from '@/lib/printer'
import { probeBrotherPrinter } from '@/lib/brother-scan'

export const runtime = 'nodejs'
export const maxDuration = 15

/**
 * 打印机探测：按模式分发
 *  - ipp（默认）：通用 IPP（631 端口）
 *  - brother：Brother 9100 直连端口探测
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json().catch(() => ({}))
  const cfg = await db.printerConfig.findUnique({ where: { id: 1 } })
  const mode = body.mode || cfg?.mode || 'ipp'

  if (mode === 'brother') {
    const host = String(body.host || cfg?.host || '').trim()
    if (!host) {
      return NextResponse.json({ code: 200, ok: false, msg: '请先填写 Brother 打印机 IP 地址' })
    }
    const r = await probeBrotherPrinter(host)
    return NextResponse.json({ code: 200, ok: r.ok, msg: r.msg })
  }

  const res = await probePrinter(body.ippUrl || '')
  return NextResponse.json({ code: 200, ok: res.ok, msg: res.msg })
}
