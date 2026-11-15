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

  try {
    const form = await req.formData()
    const file = form.get('image')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ code: 400, msg: '缺少图片' }, { status: 400 })
    }
    const buf = Buffer.from(await file.arrayBuffer())

    if (buf.length < 100) {
      return NextResponse.json({ code: 400, msg: '图片数据为空' }, { status: 400 })
    }

    const outPath = path.join(processedDir(), genFilename('.jpg'))
    let outBuf: Buffer
    try {
      // 客户端已完成增强，这里只做 EXIF 旋转 + 轻压缩
      outBuf = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer()
    } catch (sharpErr: any) {
      // JPEG 数据损坏（premature end / corrupt）→ 强制重新编码为完整 JPEG
      console.warn('[scan/pages] sharp 处理失败，尝试强制重编码:', sharpErr?.message)
      try {
        // 用 metadata 模式读，不触发解码失败；再用 raw 重新生成
        const meta = await sharp(buf).metadata().catch(() => null)
        // 最后兜底：直接把原 buffer 当作已处理 JPEG 存盘（不再二次压缩）
        if (buf[0] === 0xff && buf[1] === 0xd8) {
          // 确实是 JPEG（即便有损坏标记），直接保存原始字节
          outBuf = buf
          console.log('[scan/pages] JPEG 头有效，保存原始字节（跳过 sharp 二次处理）')
        } else {
          // 非 JPEG（PNG/WebP 等），转 JPEG
          outBuf = await sharp(buf).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
        }
      } catch (e2: any) {
        console.error('[scan/pages] 重编码也失败:', e2?.message)
        return NextResponse.json(
          { code: 500, msg: `图片处理失败：数据损坏，请重新拍摄或换一张图` },
          { status: 500 }
        )
      }
    }
    fs.writeFileSync(outPath, outBuf)
    const meta = await sharp(outBuf).metadata().catch(() => ({ width: 0, height: 0 }))

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
  } catch (e: any) {
    console.error('[scan/pages] upload error:', e?.message || e)
    return NextResponse.json(
      { code: 500, msg: `上传失败：${e?.message || '服务器内部错误'}` },
      { status: 500 }
    )
  }
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
