import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath } from '@/lib/storage'
import { printPdfFile } from '@/lib/printer'
import { generateTaskPdfs } from '@/lib/pdf-render'
import { renderAnnotatedJpegs } from '@/lib/mark-jpeg'
import { brotherPrintJpegs } from '@/lib/brother-scan'
import fs from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const { taskId, subType, ippUrl, duplex, copies, fallback } = await req.json()

  const task = await db.task.findFirst({ where: { id: taskId, userId: uid } })
  if (!task) return NextResponse.json({ code: 404, msg: '任务不存在' }, { status: 404 })

  // 取打印机配置（参数优先，否则取库内配置）
  let printer = await db.printerConfig.findUnique({ where: { id: 1 } })
  const useUrl = ippUrl || printer?.ippUrl || process.env.PRINTER_IPP_URL || ''
  const useDuplex = duplex ?? printer?.duplex ?? false
  const useCopies = copies ?? printer?.copies ?? 1
  const pMode = printer?.mode || 'ipp'
  const pHost = (printer?.host || '').trim()

  const fileType =
    subType === 'mark'
      ? 'mark_pdf'
      : subType === 'marks'
        ? 'marks_pdf'
        : subType === 'answer'
          ? 'answer_pdf'
          : 'parse_pdf'

  // 更新任务打印状态
  await db.task.update({
    where: { id: taskId },
    data: { printStatus: 'printing', printMode: subType },
  })
  await db.printSubtask.create({
    data: { taskId, subType, status: 'running' },
  })

  const finish = async (success: boolean, msg: string, extra: Record<string, any> = {}) => {
    await db.printSubtask.updateMany({
      where: { taskId, subType, status: 'running' },
      data: { status: success ? 'ok' : 'fail', msg, finishedAt: new Date() },
    })
    await db.task.update({
      where: { id: taskId },
      data: { printStatus: success ? 'print_finish' : 'print_failed' },
    })
    return NextResponse.json(
      success
        ? { code: 200, msg, ...extra }
        : { code: 500, msg, ...extra }
    )
  }

  // ---------- Brother 9100 直连模式 ----------
  if (pMode === 'brother') {
    if (!pHost) {
      return finish(false, 'Brother 直连模式未配置打印机 IP，请在设置中填写', {})
    }
    // mark / marks：批注直接渲染为 JPEG（免 PDF 光栅化）
    if (subType === 'mark' || subType === 'marks') {
      try {
        const files = await db.file.findMany({ where: { taskId, fileType: 'origin' } })
        const pageImages = new Map<number, { path: string; w: number; h: number }>()
        for (const f of files) {
          const abs = absPath(f.filePath)
          if (fs.existsSync(abs)) {
            pageImages.set(f.pageNo || 1, {
              path: abs,
              w: f.width || task.imgWidth || 1000,
              h: f.height || task.imgHeight || 1414,
            })
          }
        }
        if (pageImages.size === 0) return finish(false, '找不到原卷图片', {})
        const annotations = await db.annotation.findMany({ where: { taskId } })
        const jpegs = []
        for (let c = 0; c < useCopies; c++) {
          const pages = await renderAnnotatedJpegs(pageImages, annotations, {
            withImage: subType === 'mark',
          })
          jpegs.push(...pages.map((p) => p.jpeg))
        }
        const r = await brotherPrintJpegs(pHost, jpegs, `PM-${task.paperName}-${subType}`)
        return finish(r.ok, r.msg)
      } catch (e: any) {
        return finish(false, `Brother 打印异常：${e?.message || e}`)
      }
    }
    // answer / parse（纯文字 PDF）：直连模式不支持 → 降级浏览器打印
    let fileRow = await db.file.findFirst({ where: { taskId, fileType } })
    if (!fileRow) {
      await generateTaskPdfs(taskId)
      fileRow = await db.file.findFirst({ where: { taskId, fileType } })
    }
    if (!fileRow) return finish(false, 'PDF 文件不存在，请先生成', {})
    return NextResponse.json({
      code: 200,
      fallback: true,
      fileId: fileRow.id,
      msg: 'Brother 直连模式暂不支持文字版 PDF，已返回文件请用系统打印',
    })
  }

  // ---------- IPP 通用模式 ----------
  // 确保 PDF 存在（必要时重新生成）
  let fileRow = await db.file.findFirst({ where: { taskId, fileType } })
  if (!fileRow) {
    await generateTaskPdfs(taskId)
    fileRow = await db.file.findFirst({ where: { taskId, fileType } })
  }
  if (!fileRow) {
    return finish(false, 'PDF 文件不存在，请先生成', {})
  }

  const abs = absPath(fileRow.filePath)

  if (fallback) {
    // 兜底：直接返回 PDF 给前端，由浏览器调用系统打印
    return NextResponse.json({
      code: 200,
      fallback: true,
      fileId: fileRow.id,
      msg: '已返回 PDF，请使用浏览器打印',
    })
  }

  const result = await printPdfFile(abs, {
    ippUrl: useUrl,
    jobName: `PaperMarker-${task.paperName}-${subType}`,
    duplex: useDuplex,
    copies: useCopies,
  })

  return finish(result.success, result.msg, result.success ? {} : { fallbackPdfFileId: fileRow.id })
}
