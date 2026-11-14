import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { id } = await params

  const task = await db.task.findFirst({
    where: { id, userId: auth.uid },
    include: {
      annotations: { orderBy: { pageNo: 'asc' } },
      pages: { orderBy: { pageNo: 'asc' } },
      files: true,
    },
  })
  if (!task) {
    return NextResponse.json({ code: 404, msg: '任务不存在' }, { status: 404 })
  }

  const origin = task.files.find((f) => f.fileType === 'origin')
  const markPdf = task.files.find((f) => f.fileType === 'mark_pdf')
  const marksPdf = task.files.find((f) => f.fileType === 'marks_pdf')
  const answerPdf = task.files.find((f) => f.fileType === 'answer_pdf')
  const parsePdf = task.files.find((f) => f.fileType === 'parse_pdf')

  // 各页原图（多页任务）
  const pageFiles = task.files
    .filter((f) => f.fileType === 'origin')
    .sort((a, b) => (a.pageNo || 1) - (b.pageNo || 1))
    .map((f) => ({
      pageNo: f.pageNo || 1,
      fileId: f.id,
      w: f.width || task.imgWidth || 1000,
      h: f.height || task.imgHeight || 1414,
    }))

  return NextResponse.json({
    code: 200,
    task: {
      id: task.id,
      paperName: task.paperName,
      studentName: task.studentName,
      reviewStatus: task.reviewStatus,
      printStatus: task.printStatus,
      printMode: task.printMode,
      parseMode: task.parseMode,
      answerMode: task.answerMode,
      totalGet: task.totalGet,
      totalFull: task.totalFull,
      hasAnswerPage: task.hasAnswerPage,
      hasParsePage: task.hasParsePage,
      imgWidth: task.imgWidth,
      imgHeight: task.imgHeight,
      createdAt: task.createdAt,
      annotations: task.annotations.map((a) => ({
        id: a.id,
        pageNo: a.pageNo,
        questionText: a.questionText,
        roi: { x: a.roiX, y: a.roiY, w: a.roiW, h: a.roiH },
        judgeType: a.judgeType,
        fullScore: a.fullScore,
        getScore: a.getScore,
        confidence: a.confidence,
        briefReason: a.briefReason,
        fullSolution: a.fullSolution,
        answerText: a.answerText,
        layout: a.layout,
        reviewStatus: a.reviewStatus,
        originJudgeType: a.originJudgeType,
        originGetScore: a.originGetScore,
      })),
      pages: task.pages.map((p) => ({
        pageNo: p.pageNo,
        pageGet: p.pageGet,
        pageFull: p.pageFull,
      })),
      pageFiles,
      originFileId: origin?.id,
      markPdfFileId: markPdf?.id,
      marksPdfFileId: marksPdf?.id,
      answerPdfFileId: answerPdf?.id,
      parsePdfFileId: parsePdf?.id,
    },
  })
}
