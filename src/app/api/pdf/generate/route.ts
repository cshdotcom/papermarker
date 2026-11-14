import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { generateTaskPdfs } from '@/lib/pdf-render'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { taskId, layers } = await req.json()
  try {
    await generateTaskPdfs(taskId, layers)
    return NextResponse.json({ code: 200, msg: 'PDF 已重新生成' })
  } catch (e: any) {
    return NextResponse.json({ code: 500, msg: e?.message || '生成失败' }, { status: 500 })
  }
}
