import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  let cfg = await db.scannerConfig.findUnique({ where: { id: 1 } })
  if (!cfg) {
    cfg = await db.scannerConfig.create({ data: { id: 1 } })
  }
  return NextResponse.json({
    code: 200,
    config: {
      esclUrl: cfg.esclUrl,
      name: cfg.name,
      source: cfg.source,
      colorMode: cfg.colorMode,
      dpi: cfg.dpi,
      protocol: cfg.protocol,
      host: cfg.host,
    },
  })
}

export async function PUT(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { esclUrl, name, source, colorMode, dpi, protocol, host } = await req.json()
  const cfg = await db.scannerConfig.upsert({
    where: { id: 1 },
    update: {
      esclUrl: esclUrl ?? undefined,
      name: name ?? undefined,
      source: source ?? undefined,
      colorMode: colorMode ?? undefined,
      dpi: dpi ?? undefined,
      protocol: protocol ?? undefined,
      host: host ?? undefined,
    },
    create: {
      id: 1,
      esclUrl: esclUrl || 'http://192.168.1.100:8095/eSCL',
      name: name || '网络扫描仪',
      source: source || 'Platen',
      colorMode: colorMode || 'RGB24',
      dpi: dpi || 200,
      protocol: protocol || 'escl',
      host: host || '',
    },
  })
  return NextResponse.json({
    code: 200,
    msg: '已保存',
    config: {
      esclUrl: cfg.esclUrl,
      name: cfg.name,
      source: cfg.source,
      colorMode: cfg.colorMode,
      dpi: cfg.dpi,
      protocol: cfg.protocol,
      host: cfg.host,
    },
  })
}
