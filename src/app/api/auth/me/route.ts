import { NextRequest, NextResponse } from 'next/server'
import { authGuard } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await authGuard(req)
  if (!auth.ok) return auth.resp
  return NextResponse.json({
    code: 200,
    user: { id: auth.uid, username: auth.username },
  })
}
