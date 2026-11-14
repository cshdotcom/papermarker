import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  let cfg = await db.printerConfig.findUnique({ where: { id: 1 } })
  if (!cfg) {
    cfg = await db.printerConfig.create({ data: { id: 1 } })
  }
  return NextResponse.json({
    code: 200,
    config: {
      ippUrl: cfg.ippUrl,
      name: cfg.name,
      duplex: cfg.duplex,
      copies: cfg.copies,
      mode: cfg.mode,
      host: cfg.host,
    },
  })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { ippUrl, name, duplex, copies, mode, host } = await req.json()
  const cfg = await db.printerConfig.upsert({
    where: { id: 1 },
    update: {
      ippUrl: ippUrl ?? undefined,
      name: name ?? undefined,
      duplex: duplex ?? undefined,
      copies: copies ?? undefined,
      mode: mode ?? undefined,
      host: host ?? undefined,
    },
    create: {
      id: 1,
      ippUrl: ippUrl || 'http://192.168.1.100:631/ipp/print',
      name: name || '网络打印机',
      duplex: duplex ?? false,
      copies: copies ?? 1,
      mode: mode || 'ipp',
      host: host || '',
    },
  })
  return NextResponse.json({
    code: 200,
    msg: '已保存',
    config: {
      ippUrl: cfg.ippUrl,
      name: cfg.name,
      duplex: cfg.duplex,
      copies: cfg.copies,
      mode: cfg.mode,
      host: cfg.host,
    },
  })
}
