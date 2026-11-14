import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { generateTaskPdfs } from '@/lib/pdf-render'

export async function PATCH(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const uid = auth.uid

  const body = await req.json()
  const {
    id,
    judgeType,
    getScore,
    fullScore,
    briefReason,
    fullSolution,
    answerText,
    layout,
    reviewStatus,
  } = body

  const ann = await db.annotation.findUnique({
    where: { id },
    include: { task: true },
  })
  if (!ann || ann.task.userId !== uid) {
    return NextResponse.json({ code: 404, msg: '批注不存在' }, { status: 404 })
  }

  const data: any = { reviewUid: uid, reviewAt: new Date() }
  if (judgeType !== undefined) data.judgeType = judgeType
  if (getScore !== undefined) data.getScore = Math.min(Number(getScore), fullScore ?? ann.fullScore)
  if (fullScore !== undefined) data.fullScore = Number(fullScore)
  if (briefReason !== undefined) data.briefReason = briefReason
  if (fullSolution !== undefined) data.fullSolution = fullSolution
  if (answerText !== undefined) data.answerText = answerText
  if (layout !== undefined) data.layout = layout
  if (reviewStatus !== undefined) data.reviewStatus = reviewStatus
  else data.reviewStatus = 'reviewed'

  await db.annotation.update({ where: { id }, data })

  // 重新汇总 task 总分
  const all = await db.annotation.findMany({ where: { taskId: ann.taskId } })
  const totalGet = all.reduce((s, a) => s + a.getScore, 0)
  const totalFull = all.reduce((s, a) => s + a.fullScore, 0)
  await db.task.update({
    where: { id: ann.taskId },
    data: { totalGet, totalFull },
  })

  // 重新生成 PDF（失败不阻塞）
  generateTaskPdfs(ann.taskId).catch((e) =>
    console.warn('[annotation] PDF 重生成失败:', e?.message)
  )

  return NextResponse.json({ code: 200, msg: '已保存', totalGet, totalFull })
}
