import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { processedDir, genFilename, relPath, absPath } from '@/lib/storage'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 30

/** 扫描托盘：列出手头未建任务的页 */
export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const files = await db.file.findMany({
    where: { userId: auth.uid, taskId: null, fileType: 'scan_tmp' },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    code: 200,
    pages: files.map((f) => ({
      id: f.id,
      url: `/api/file/${f.id}`,
      w: f.width || 0,
      h: f.height || 0,
    })),
  })
}

/** 上传一页（手机相机扫描：客户端完成透视矫正/增强后上传） */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const form = await req.formData()
  const file = form.get('image')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ code: 400, msg: '缺少图片' }, { status: 400 })
  }
  const buf = Buffer.from(await file.arrayBuffer())

  const outPath = path.join(processedDir(), genFilename('.jpg'))
  // 客户端已完成增强，这里只做 EXIF 旋转 + 轻压缩，避免二次处理冲掉黑白增强效果
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

  return NextResponse.json({
    code: 200,
    page: { id: f.id, url: `/api/file/${f.id}`, w: meta.width || 0, h: meta.height || 0 },
  })
}

/** 删除托盘页：?id=xxx 删除指定页；无参数清空全部 */
export async function DELETE(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const f = await db.file.findFirst({
      where: { id, userId: uid, taskId: null, fileType: 'scan_tmp' },
    })
    if (!f) return NextResponse.json({ code: 404, msg: '页面不存在' }, { status: 404 })
    await db.file.delete({ where: { id } })
    try {
      fs.unlinkSync(absPath(f.filePath))
    } catch {}
  } else {
    const files = await db.file.findMany({
      where: { userId: uid, taskId: null, fileType: 'scan_tmp' },
    })
    for (const f of files) {
      await db.file.delete({ where: { id: f.id } })
      try {
        fs.unlinkSync(absPath(f.filePath))
      } catch {}
    }
  }
  return NextResponse.json({ code: 200, msg: '已删除' })
}
