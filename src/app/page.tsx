'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Settings as SettingsIcon,
  LayoutDashboard,
  Loader2,
  LogOut,
  PenLine,
  ScanLine,
} from 'lucide-react'
import { usePm } from '@/lib/pm-store'
import { api } from '@/lib/pm'
import { Dashboard } from '@/components/pm/dashboard'
import { Review } from '@/components/pm/review'
import { Settings } from '@/components/pm/settings'
import { ScanView } from '@/components/pm/scan/scan-view'
import { LoginView } from '@/components/pm/login-view'
import { Button } from '@/components/ui/button'

export default function Home() {
  const {
    view,
    setView,
    authed,
    authLoading,
    setAuthed,
    setAuthLoading,
    username,
    setUsername,
    logout,
    openTask,
    currentTaskId,
  } = usePm()

  const [bootError, setBootError] = useState<string | null>(null)

  // 启动：仅校验已有登录态（localStorage token / cookie），不自动登录
  useEffect(() => {
    let mounted = true
    ;(async () => {
      setAuthLoading(true)
      try {
        const me = await api.me().catch(() => null)
        if (me?.user && mounted) {
          setAuthed(true)
          setUsername(me.user.username)
        } else if (mounted) {
          setAuthed(false)
        }
      } finally {
        if (mounted) setAuthLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [setAuthed, setAuthLoading, setUsername])

  const doLogout = () => {
    api.logout()
    logout()
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm text-muted-foreground">正在检查登录状态…</p>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{bootError}</p>
      </div>
    )
  }

  // 未登录：登录门禁页
  if (!authed) {
    return (
      <LoginView
        onLogin={(u) => {
          setAuthed(true)
          setUsername(u)
        }}
      />
    )
  }

  const NAV = [
    { key: 'scan' as const, label: '扫描', icon: ScanLine },
    { key: 'dashboard' as const, label: '任务', icon: LayoutDashboard },
    { key: 'settings' as const, label: '设置', icon: SettingsIcon },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      {/* Header（桌面端主导航） */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <PenLine className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">PaperMarker</div>
              <div className="hidden text-[10px] text-muted-foreground sm:block">
                试卷扫描 · AI 批改 · 一体机打印
              </div>
            </div>
          </div>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            <Button
              variant={view === 'scan' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('scan')}
              className={view === 'scan' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <ScanLine className="mr-1.5 h-4 w-4" />
              扫描
            </Button>
            <Button
              variant={view === 'dashboard' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('dashboard')}
              className={view === 'dashboard' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <LayoutDashboard className="mr-1.5 h-4 w-4" />
              任务
            </Button>
            <Button
              variant={view === 'settings' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('settings')}
              className={view === 'settings' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <SettingsIcon className="mr-1.5 h-4 w-4" />
              设置
            </Button>
          </nav>

          {/* 用户区 */}
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline">
              {username || '用户'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={doLogout}
              title="退出登录"
              className="text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main（移动端为底部导航预留空间） */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6">
        {view === 'scan' && <ScanView />}
        {view === 'dashboard' && <Dashboard onOpenTask={openTask} />}
        {view === 'review' && currentTaskId && <Review taskId={currentTaskId} />}
        {view === 'review' && !currentTaskId && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8" />
            <p>请从任务列表选择一个任务进行复核</p>
          </div>
        )}
        {view === 'settings' && <Settings />}
      </main>

      {/* Footer（桌面端展示，移动端由底部导航承担） */}
      <footer className="mt-auto hidden border-t bg-background md:block">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-xs text-muted-foreground sm:flex-row">
          <span>PaperMarker · Next.js 16 + Prisma(SQLite) · eSCL / Brother 54921 扫描 + IPP / 9100 直连打印</span>
          <span>佳能 / 兄弟 / 惠普等主流局域网打印扫描一体机通用</span>
        </div>
      </footer>

      {/* 移动端底部导航（APP 式） */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 pb-[env(safe-area-inset-bottom)]">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = view === n.key || (n.key === 'dashboard' && view === 'review')
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition ${
                  active ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                {n.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
