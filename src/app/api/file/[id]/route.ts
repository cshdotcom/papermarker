import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { absPath } from '@/lib/storage'
import fs from 'fs'
import path from 'path'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  const { id } = await params

  const file = await db.file.findUnique({
    where: { id },
    include: { task: true },
  })
  // 归属校验：任务文件 → 任务属主；托盘文件（taskId 为空）→ userId
  const owned =
    file && (file.taskId ? file.task?.userId === auth.uid : file.userId === auth.uid)
  if (!file || !owned) {
    return NextResponse.json({ code: 404, msg: '文件不存在' }, { status: 404 })
  }

  const abs = absPath(file.filePath)
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ code: 404, msg: '文件丢失' }, { status: 404 })
  }

  const ext = path.extname(file.filePath).toLowerCase()
  const mime =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' : 'image/jpeg'

  const buf = fs.readFileSync(abs)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'Content-Length': String(buf.length),
    },
  })
}
