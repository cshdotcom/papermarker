import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { generateTaskPdfs } from '@/lib/pdf-render'

/** 批量复核：一键全部通过 / 恢复 AI 判断 */
export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid
  const { taskId, action } = await req.json()

  const task = await db.task.findFirst({ where: { id: taskId, userId: uid } })
  if (!task) return NextResponse.json({ code: 404, msg: '任务不存在' }, { status: 404 })

  if (action === 'review_all') {
    await db.annotation.updateMany({
      where: { taskId },
      data: { reviewStatus: 'reviewed', reviewUid: uid, reviewAt: new Date() },
    })
    await db.task.update({
      where: { id: taskId },
      data: { reviewStatus: 'reviewed_ok', reviewUid: uid, reviewAt: new Date() },
    })
  } else if (action === 'reset_ai') {
    await db.annotation.updateMany({
      where: { taskId },
      data: {
        reviewStatus: 'ai_only',
        reviewUid: null,
        reviewAt: null,
        judgeType: undefined,
        getScore: undefined,
      },
    })
    // 用 origin 恢复
    const all = await db.annotation.findMany({ where: { taskId } })
    for (const a of all) {
      if (a.originJudgeType || a.originGetScore !== null) {
        await db.annotation.update({
          where: { id: a.id },
          data: {
            judgeType: a.originJudgeType || a.judgeType,
            getScore: a.originGetScore ?? a.getScore,
          },
        })
      }
    }
    await db.task.update({
      where: { id: taskId },
      data: { reviewStatus: 'pending_review', reviewUid: null, reviewAt: null },
    })
  }

  generateTaskPdfs(taskId).catch(() => {})

  return NextResponse.json({ code: 200, msg: '批量操作完成' })
}
