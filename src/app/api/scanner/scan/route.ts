import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { scanPages } from '@/lib/scanner'
import { brotherScanPages, type BrotherColorMode } from '@/lib/brother-scan'
import { processedDir, genFilename, relPath } from '@/lib/storage'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 300

async function saveJpegToTray(buf: Buffer, uid: string) {
  const outPath = path.join(processedDir(), genFilename('.jpg'))
  const outBuf = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer()
  fs.writeFileSync(outPath, outBuf)
  const meta = await sharp(outBuf).metadata()
  const f = await db.file.create({
    data: {
      fileType: 'scan_tmp',
      filePath: relPath(outPath),
      userId: uid,
      width: meta.width || 0,
      height: meta.height || 0,
    },
  })
  return { id: f.id, url: `/api/file/${f.id}`, w: meta.width || 0, h: meta.height || 0 }
}

/**
 * 网络扫描：按配置协议分发
 *  - escl：eSCL/AirScan 通用（HTTP 8095）
 *  - brother：Brother 私有协议（TCP 54921，ESC X 直扫，真机已打通）
 * 扫描结果存入扫描托盘（fileType=scan_tmp，未关联任务）
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const body = await req.json().catch(() => ({}))
  const cfg = await db.scannerConfig.findUnique({ where: { id: 1 } })
  const protocol = body.protocol || cfg?.protocol || 'escl'

  // ---------- Brother 私有协议 ----------
  if (protocol === 'brother') {
    const host = String(body.host || cfg?.host || '').trim()
    if (!host) {
      return NextResponse.json(
        { code: 400, msg: '请先在设置中配置 Brother 打印机 IP' },
        { status: 400 }
      )
    }
    // eSCL 色彩枚举 → Brother 模式映射
    const colorMap: Record<string, BrotherColorMode> = {
      RGB24: 'C256',
      Grayscale8: 'CGRAY',
      BlackAndWhite1: 'TEXT',
    }
    const r = await brotherScanPages(host, {
      dpi: Number(body.dpi || cfg?.dpi || 300),
      colorMode: colorMap[body.colorMode || cfg?.colorMode || 'Grayscale8'] || 'CGRAY',
      source: (body.source || cfg?.source || 'Platen') === 'Feeder' ? 'Feeder' : 'Platen',
    })
    if (!r.ok) {
      return NextResponse.json({ code: 500, msg: r.msg, trace: r.trace }, { status: 500 })
    }
    const pages = []
    for (const p of r.pages) {
      pages.push(await saveJpegToTray(p.buffer, uid))
    }
    return NextResponse.json({ code: 200, msg: r.msg, pages })
  }

  // ---------- eSCL 通用 ----------
  const esclUrl = body.esclUrl || cfg?.esclUrl || ''
  const source = body.source || cfg?.source || 'Platen'
  const colorMode = body.colorMode || cfg?.colorMode || 'RGB24'
  const dpi = Number(body.dpi || cfg?.dpi || 200)

  if (!esclUrl) {
    return NextResponse.json(
      { code: 400, msg: '请先在设置中配置扫描仪 eSCL 地址' },
      { status: 400 }
    )
  }

  const r = await scanPages(esclUrl, { source, colorMode, dpi })
  if (!r.ok) {
    return NextResponse.json({ code: 500, msg: r.msg }, { status: 500 })
  }

  const pages = []
  for (const p of r.pages) {
    let buf = p.buffer
    if (!/jpe?g/i.test(p.contentType)) {
      buf = await sharp(buf).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
    }
    pages.push(await saveJpegToTray(buf, uid))
  }

  return NextResponse.json({ code: 200, msg: r.msg, pages })
}
