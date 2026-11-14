import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath, pdfDir, relPath } from '@/lib/storage'
import { printPdfFile } from '@/lib/printer'
import { renderImagesPdf } from '@/lib/pdf-render'
import { imageToPrintJpeg } from '@/lib/mark-jpeg'
import { brotherPrintJpegs } from '@/lib/brother-scan'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 快速复印：把扫描托盘/任务页面下发打印机。
 *  - IPP 模式：合成 PDF → IPP 631
 *  - Brother 模式：页面直接转 JPEG → 9100 直连
 * 失败时返回 PDF 文件 ID，前端打开浏览器打印兜底。
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const { fileIds, ippUrl, duplex, copies, fallback } = await req.json()
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ code: 400, msg: '未选择任何页面' }, { status: 400 })
  }

  // 校验归属（托盘页 or 任务页）
  const images: { path: string; w: number; h: number }[] = []
  for (const fid of fileIds) {
    const f = await db.file.findUnique({ where: { id: fid }, include: { task: true } })
    const owned = f && (f.userId === uid || f.task?.userId === uid) && f.fileType !== 'copy_pdf'
    if (!owned || !f.width || !f.height) continue
    images.push({ path: absPath(f.filePath), w: f.width, h: f.height })
  }
  if (images.length === 0) {
    return NextResponse.json({ code: 400, msg: '没有可用的扫描页面' }, { status: 400 })
  }

  let printer = await db.printerConfig.findUnique({ where: { id: 1 } })
  const useDuplex = duplex ?? printer?.duplex ?? false
  const useCopies = copies ?? printer?.copies ?? 1

  // ---------- Brother 9100 直连模式 ----------
  if (printer?.mode === 'brother') {
    const host = (printer.host || '').trim()
    if (!host) {
      return NextResponse.json(
        { code: 500, msg: 'Brother 直连模式未配置打印机 IP，请在设置中填写' },
        { status: 500 }
      )
    }
    try {
      const jpegs: Buffer[] = []
      for (let c = 0; c < useCopies; c++) {
        for (const img of images) {
          jpegs.push(await imageToPrintJpeg(img.path))
        }
      }
      const r = await brotherPrintJpegs(host, jpegs, `PM-复印-${images.length}页`)
      return NextResponse.json(
        r.ok ? { code: 200, msg: r.msg } : { code: 500, msg: r.msg }
      )
    } catch (e: any) {
      return NextResponse.json(
        { code: 500, msg: `Brother 复印异常：${e?.message || e}` },
        { status: 500 }
      )
    }
  }

  // ---------- IPP 通用模式 ----------
  // 生成复印 PDF
  const outPath = path.join(pdfDir(), `copy-${uuidv4()}.pdf`)
  await renderImagesPdf(outPath, images)
  const rec = await db.file.create({
    data: {
      fileType: 'copy_pdf',
      filePath: relPath(outPath),
      userId: uid,
      width: images[0].w,
      height: images[0].h,
    },
  })

  if (fallback) {
    return NextResponse.json({
      code: 200,
      fallback: true,
      fileId: rec.id,
      msg: '已返回 PDF，请使用浏览器打印',
    })
  }

  const useUrl = ippUrl || printer?.ippUrl || ''
  const result = await printPdfFile(outPath, {
    ippUrl: useUrl,
    jobName: `PaperMarker-复印-${images.length}页`,
    duplex: useDuplex,
    copies: useCopies,
  })

  return NextResponse.json(
    result.success
      ? { code: 200, msg: result.msg }
      : { code: 500, msg: result.msg, fallbackPdfFileId: rec.id }
  )
}
