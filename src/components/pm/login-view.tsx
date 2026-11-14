'use client'

import { useState } from 'react'
import { PenLine, Loader2, LogIn, KeyRound, Info } from 'lucide-react'
import { api } from '@/lib/pm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  onLogin: (username: string) => void
}

/**
 * 登录门禁：必须输入账号密码才能进入 PaperMarker
 * 默认演示账号 teacher / papermarker（可在数据库中修改）
 */
export function LoginView({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入账号和密码')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await api.login(username.trim(), password)
      if (r?.code === 200 || r?.token) {
        onLogin(r?.user?.username || username.trim())
      } else {
        setError(r?.msg || '登录失败')
      }
    } catch (e: any) {
      setError(e?.message || '登录失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/60 via-muted/20 to-muted/30">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
              <PenLine className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">PaperMarker</h1>
            <p className="text-sm text-muted-foreground">
              试卷扫描 · AI 批改 · 一体机打印
            </p>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-emerald-600" />
                登录
              </CardTitle>
              <CardDescription>请输入账号和密码进入系统</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-username">账号</Label>
                  <Input
                    id="login-username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入账号"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    disabled={loading}
                  />
                </div>

                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在登录…
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-4 w-4" />
                      登 录
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-4 flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  首次部署默认账号 <code className="font-semibold">teacher</code> / 密码{' '}
                  <code className="font-semibold">papermarker</code>，登录后可在设置中创建应用连接 API Key。
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="mt-auto pb-6 pt-2 text-center text-xs text-muted-foreground">
        PaperMarker · Next.js 16 + Prisma(SQLite) · eSCL / Brother 54921 扫描 · IPP / 9100 直连打印
      </footer>
    </div>
  )
}
