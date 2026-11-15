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
 *
 * 架构说明：
 *  服务器需与扫描仪在同一局域网才能连接 192.168.x.x。
 *  云端部署时服务器无法访问局域网设备 → 返回明确提示，
 *  引导用户使用「手机相机拍照」或自托管应用。
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
      // 服务器在云端无法访问局域网设备 → 给出可操作的提示
      const isCloud = !host.startsWith('127.') && !host.startsWith('localhost')
      const hint = isCloud
        ? `${r.msg}\n\n提示：服务器在云端，无法访问局域网打印机 ${host}。请改用「手机相机拍照」批改，或将应用自托管到与打印机同一网络的设备上。`
        : r.msg
      return NextResponse.json({ code: 500, msg: hint, trace: r.trace }, { status: 500 })
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
    // 服务器在云端无法访问局域网设备 → 给出可操作的提示
    const hint = `${r.msg}\n\n提示：服务器在云端，无法访问局域网扫描仪。请改用「手机相机拍照」批改，或将应用自托管到与扫描仪同一网络的设备上。`
    return NextResponse.json({ code: 500, msg: hint }, { status: 500 })
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
