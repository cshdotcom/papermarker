import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { probeScanner } from '@/lib/scanner'
import { probeBrotherScanner } from '@/lib/brother-scan'

export const runtime = 'nodejs'
export const maxDuration = 15

/**
 * 扫描仪探测：按协议分发
 *  - escl（默认）：通用 eSCL/AirScan（佳能/惠普/爱普生及海外版兄弟）
 *  - brother：Brother 私有协议 TCP 54921（国行 DCP-T428W 等无 eSCL 的机型）
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const body = await req.json().catch(() => ({}))
  const cfg = await db.scannerConfig.findUnique({ where: { id: 1 } })
  const protocol = body.protocol || cfg?.protocol || 'escl'

  if (protocol === 'brother') {
    const host = String(body.host || cfg?.host || '').trim()
    if (!host) {
      return NextResponse.json({
        code: 200,
        ok: false,
        msg: '请先填写 Brother 打印机 IP 地址',
      })
    }
    const r = await probeBrotherScanner(host)
    return NextResponse.json({
      code: 200,
      ok: r.ok,
      msg: r.msg,
      caps: r.ok
        ? {
            name: `Brother ${host}（私有协议 54921）`,
            platen: true,
            adf: false,
            duplex: false,
            colorModes: ['CGRAY 灰度', 'C256 彩色', 'TEXT 黑白'],
            resolutions: [100, 200, 300, 600],
            maxW: 2480,
            maxH: 3508,
          }
        : undefined,
      trace: r.trace,
    })
  }

  // eSCL 通用探测
  const r = await probeScanner(body.esclUrl || '')
  return NextResponse.json({
    code: 200,
    ok: r.ok,
    msg: r.msg,
    caps: r.caps,
  })
}
