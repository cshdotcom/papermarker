import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath } from '@/lib/storage'
import { renderAnnotatedJpegs } from '@/lib/mark-jpeg'
import { normalizeLayers } from '@/lib/pdf-render'
import fs from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 浏览器直接打印数据源：
 * GET /api/print/pages?taskId=xx&withImage=1&layers=...
 * 返回按图层渲染好的批注页 JPEG（base64 data URL），前端逐页展示后 window.print()。
 * 不依赖局域网直连（IPP/9100），任何网络环境都能打印 —— 解决「无法打印」。
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp

  const taskId = req.nextUrl.searchParams.get('taskId')
  if (!taskId) {
    return NextResponse.json({ code: 400, msg: '缺少 taskId' }, { status: 400 })
  }

  const task = await db.task.findFirst({ where: { id: taskId, userId: auth.uid } })
  if (!task) return NextResponse.json({ code: 404, msg: '任务不存在' }, { status: 404 })

  const withImage = req.nextUrl.searchParams.get('withImage') !== '0'
  let layers: any = undefined
  const rawLayers = req.nextUrl.searchParams.get('layers')
  if (rawLayers) {
    try {
      layers = normalizeLayers(JSON.parse(rawLayers))
    } catch {}
  }

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
  if (pageImages.size === 0) {
    return NextResponse.json({ code: 404, msg: '找不到原卷图片' }, { status: 404 })
  }

  const annotations = await db.annotation.findMany({ where: { taskId } })

  try {
    const pages = await renderAnnotatedJpegs(pageImages, annotations, {
      withImage,
      layers,
      width: 2480, // A4 @300dpi，打印清晰度与桥接光栅化对齐
      meta: { paperName: task.paperName, studentName: task.studentName },
    })
    return NextResponse.json({
      code: 200,
      pages: pages.map((p) => ({
        pageNo: p.pageNo,
        dataUrl: `data:image/jpeg;base64,${p.jpeg.toString('base64')}`,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ code: 500, msg: `渲染失败：${e?.message || e}` }, { status: 500 })
  }
}
