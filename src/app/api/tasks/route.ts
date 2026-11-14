import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const tasks = await db.task.findMany({
    where: { userId: auth.uid },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { annotations: true } } },
  })
  return NextResponse.json({
    code: 200,
    tasks: tasks.map((t) => ({
      id: t.id,
      paperName: t.paperName,
      studentName: t.studentName,
      createdAt: t.createdAt,
      reviewStatus: t.reviewStatus,
      printStatus: t.printStatus,
      totalGet: t.totalGet,
      totalFull: t.totalFull,
      annotationCount: t._count.annotations,
    })),
  })
}
