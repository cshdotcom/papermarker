import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { processedDir, genFilename, relPath } from '@/lib/storage'
import { gradeImages, persistGrade } from '@/lib/ai-gateway'
import { generateTaskPdfs } from '@/lib/pdf-render'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * 安卓 APP（com.papermarker.app）直传入口：
 * POST multipart/form-data（boundary=----PaperMarkerFormBoundary7MA4YWxk）
 *   - images: 多个 JPEG 文件（相机拍摄 / 相册多选，顺序即页码）
 *   - paperName / studentName: 文本字段
 * 鉴权：Authorization: Bearer <token> 或 X-API-Key（authGuard 统一处理）
 * 响应：{ code, msg, taskId, summary: { pageCount, questionCount, totalGet, totalFull } }
 * （对齐 APK ApiClient.uploadPages 的解析契约，修复「上传失败 Server action not found」）
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ code: 400, msg: '表单解析失败' }, { status: 400 })
  }

  // 收集 images 字段（APK 逐个 part 均名 images）
  const images: File[] = []
  for (const [key, value] of form.entries()) {
    if (key === 'images' && value instanceof File) images.push(value)
  }
  if (images.length === 0) {
    return NextResponse.json({ code: 400, msg: '未收到任何页面图片' }, { status: 400 })
  }

  const paperName = (form.get('paperName') as string) || ''
  const studentName = (form.get('studentName') as string) || ''

  // 1) 保存图片（EXIF 旋转 + 轻压缩；APP 端已完成透视矫正）
  const saved: { id: string; abs: string; w: number; h: number }[] = []
  for (const img of images) {
    try {
      const buf = Buffer.from(await img.arrayBuffer())
      const outBuf = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer()
      const outPath = path.join(processedDir(), genFilename('.jpg'))
      fs.writeFileSync(outPath, outBuf)
      const meta = await sharp(outBuf).metadata()
      const f = await db.file.create({
        data: {
          fileType: 'scan_tmp',
          filePath: relPath(outPath),
          userId: uid,
          width: meta.width || 1000,
          height: meta.height || 1414,
        },
      })
      saved.push({ id: f.id, abs: outPath, w: meta.width || 1000, h: meta.height || 1414 })
    } catch (e: any) {
      // 单页失败不阻塞整任务
      console.warn('[upload] 页面处理失败:', e?.message)
    }
  }
  if (saved.length === 0) {
    return NextResponse.json({ code: 500, msg: '页面图片处理失败' }, { status: 500 })
  }

  // 2) 建任务并绑定页面
  const first = saved[0]
  const task = await db.task.create({
    data: {
      userId: uid,
      paperName: paperName || '未命名试卷',
      studentName: studentName || null,
      reviewStatus: 'pending_ai',
      printStatus: 'idle',
      parseMode: 'auto_ask',
      answerMode: 'auto_ask',
      totalGet: 0,
      totalFull: 0,
      imgWidth: first.w,
      imgHeight: first.h,
    },
  })
  for (let i = 0; i < saved.length; i++) {
    await db.file.update({
      where: { id: saved[i].id },
      data: { taskId: task.id, fileType: 'origin', pageNo: i + 1, userId: null },
    })
  }

  // 3) VLM 批改
  let result
  try {
    result = await gradeImages(saved.map((s) => s.abs))
    await persistGrade(task.id, result)
  } catch (e: any) {
    await db.task.update({
      where: { id: task.id },
      data: { reviewStatus: 'pending_review' },
    })
    return NextResponse.json({
      code: 500,
      msg: `AI 批改失败：${e?.message || e}`,
      taskId: task.id,
    })
  }

  // 4) PDF（失败不阻塞返回）
  try {
    await generateTaskPdfs(task.id)
  } catch (e: any) {
    console.warn('[upload] PDF 生成失败:', e?.message)
  }

  await db.task.update({
    where: { id: task.id },
    data: { reviewStatus: 'pending_review' },
  })

  return NextResponse.json({
    code: 200,
    msg: `已创建 ${saved.length} 页批改任务`,
    taskId: task.id,
    summary: {
      totalGet: result.totalGet,
      totalFull: result.totalFull,
      questionCount: result.questions.length,
      pageCount: saved.length,
    },
  })
}
