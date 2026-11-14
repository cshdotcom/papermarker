import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath } from '@/lib/storage'
import { gradeImages, persistGrade } from '@/lib/ai-gateway'
import { generateTaskPdfs } from '@/lib/pdf-render'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 从扫描托盘的页面创建多页批改任务：
 * 1. 校验 fileIds 归属当前用户（scan_tmp）
 * 2. 依次绑定到新任务（pageNo=1..N, fileType=origin）
 * 3. VLM 多页批改 → 汇总 → 生成三类 PDF
 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const { fileIds, paperName, studentName } = await req.json()
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ code: 400, msg: '未选择任何页面' }, { status: 400 })
  }

  // 按传入顺序取托盘页（保持用户排序）
  const files = []
  for (const fid of fileIds) {
    const f = await db.file.findFirst({
      where: { id: fid, userId: uid, taskId: null, fileType: 'scan_tmp' },
    })
    if (!f) {
      return NextResponse.json(
        { code: 400, msg: '存在无效页面，请刷新托盘后重试' },
        { status: 400 }
      )
    }
    files.push(f)
  }

  const first = files[0]
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
      imgWidth: first.width || 1000,
      imgHeight: first.height || 1414,
    },
  })

  // 绑定页面到任务
  for (let i = 0; i < files.length; i++) {
    await db.file.update({
      where: { id: files[i].id },
      data: { taskId: task.id, fileType: 'origin', pageNo: i + 1, userId: null },
    })
  }

  // VLM 多页批改
  const paths = files.map((f) => absPath(f.filePath))
  const result = await gradeImages(paths)
  await persistGrade(task.id, result)

  // 生成 PDF（失败不阻塞）
  try {
    await generateTaskPdfs(task.id)
  } catch (e: any) {
    console.warn('[from-pages] PDF 生成失败:', e?.message)
  }

  await db.task.update({
    where: { id: task.id },
    data: { reviewStatus: 'pending_review' },
  })

  return NextResponse.json({
    code: 200,
    taskId: task.id,
    msg: `已创建 ${files.length} 页批改任务`,
    summary: {
      totalGet: result.totalGet,
      totalFull: result.totalFull,
      questionCount: result.questions.length,
      pageCount: files.length,
    },
  })
}
