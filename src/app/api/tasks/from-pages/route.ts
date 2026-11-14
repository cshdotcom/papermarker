import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath } from '@/lib/storage'
import { gradeImages, persistGrade } from '@/lib/ai-gateway'
import { generateTaskPdfs } from '@/lib/pdf-render'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 从扫描托盘的页面创建多页批改任务（异步批改 v2）：
 * 1. 校验 fileIds 归属当前用户（scan_tmp）
 * 2. 依次绑定到新任务（pageNo=1..N, fileType=origin）
 * 3. 立即返回 taskId（状态 pending_ai），后台异步执行 VLM 批改 + PDF 生成
 *
 * 修复「上传后卡在批改中 30 秒」：上传成功即视为本步完成，
 * 批改在后台进行，前端打开任务后看到 pending_ai 自动轮询直到 pending_review。
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

  const pageCount = files.length

  // 后台异步批改（不阻塞响应）：
  // after() 保证请求结束后继续执行，批改完成更新状态为 pending_review
  after(async () => {
    const tid = task.id
    try {
      const paths = files.map((f) => absPath(f.filePath))
      const result = await gradeImages(paths)
      await persistGrade(tid, result)

      // 生成 PDF（失败不阻塞批改结果）
      try {
        await generateTaskPdfs(tid)
      } catch (e: any) {
        console.warn(`[from-pages] 任务 ${tid} PDF 生成失败:`, e?.message)
      }

      await db.task.update({
        where: { id: tid },
        data: { reviewStatus: 'pending_review' },
      })
      console.log(`[from-pages] 任务 ${tid} 批改完成：${result.totalGet}/${result.totalFull}，${result.questions.length} 题`)
    } catch (e: any) {
      console.error(`[from-pages] 任务 ${tid} 批改失败:`, e?.message || e)
      await db.task.update({
        where: { id: tid },
        data: { reviewStatus: 'pending_review' },
      }).catch(() => {})
    }
  })

  // 立即返回 —— 上传成功即视为本步完成
  return NextResponse.json({
    code: 200,
    taskId: task.id,
    status: 'pending_ai',
    msg: `已创建 ${pageCount} 页批改任务，AI 正在后台批改`,
    summary: {
      pageCount,
    },
  })
}
