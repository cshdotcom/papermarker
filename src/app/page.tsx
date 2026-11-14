'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Settings as SettingsIcon,
  LayoutDashboard,
  PenLine,
  ScanLine,
  LogOut,
} from 'lucide-react'
import { usePm } from '@/lib/pm-store'
import { api, getStoredToken, getCachedUsername, normalizeLayers } from '@/lib/pm'
import { Dashboard } from '@/components/pm/dashboard'
import { Review } from '@/components/pm/review'
import { Settings } from '@/components/pm/settings'
import { ScanView } from '@/components/pm/scan/scan-view'
import { LoginView } from '@/components/pm/login-view'
import { Button } from '@/components/ui/button'

/**
 * 启动骨架（与主界面同构）：避免「检查登录中→主界面」的闪屏。
 * 仅在首帧（SSR/水合）出现，token 存在时下一帧即为主界面。
 */
function BootSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="sticky top-0 z-30 border-b bg-background/95">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
            <PenLine className="h-4 w-4 text-white" />
          </div>
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-8 w-40 animate-pulse rounded bg-muted" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </main>
    </div>
  )
}

export default function Home() {
  const {
    view,
    setView,
    authed,
    username,
    setUsername,
    setAuthed,
    setLayers,
    logout,
    openTask,
    currentTaskId,
  } = usePm()

  // 首帧（与 SSR 一致）显示骨架；挂载后同步读取本地 token 立即定向
  const [mounted, setMounted] = useState(false)
  const [hasToken, setHasToken] = useState(false)

  useEffect(() => {
    // 1) 同步判定：有 token → 直接进主界面（乐观渲染，无闪屏）
    const token = getStoredToken()
    const cached = getCachedUsername()
    setHasToken(!!token)
    setMounted(true)
    if (token) {
      setAuthed(true)
      if (cached) setUsername(cached)
    }

    // 2) 后台静默校验：过期则回登录页；成功则同步服务端图层默认配置
    if (!token) return
    let alive = true
    ;(async () => {
      try {
        const me = await api.me()
        if (!alive) return
        setAuthed(true)
        setUsername(me.user.username)
        if (me.config?.layers) setLayers(normalizeLayers(me.config.layers))
      } catch {
        // token 失效 / 网络异常：仅在校验确凿失败（401 等）时回登录
        if (alive) {
          setAuthed(false)
          try {
            localStorage.removeItem('pm_token')
            sessionStorage.removeItem('pm_token')
          } catch {}
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doLogout = () => {
    api.logout()
    logout()
  }

  // 首帧（SSR / 水合前）：显示与主界面同构的骨架，不闪屏
  if (!mounted) return <BootSkeleton />

  // 无 token：直接登录页（不经过任何加载态）
  if (!authed && !hasToken) {
    return (
      <LoginView
        onLogin={(u) => {
          setHasToken(true)
          setAuthed(true)
          setUsername(u)
        }}
      />
    )
  }

  // token 校验失败（authed 被后台置 false）
  if (!authed) {
    return (
      <LoginView
        onLogin={(u) => {
          setHasToken(true)
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
          <div className="flex shrink-0 items-center gap-2">
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

          <nav className="mx-auto hidden items-center gap-1 md:flex">
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
              variant={view === 'dashboard' || view === 'review' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('dashboard')}
              className={view === 'dashboard' || view === 'review' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
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
          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
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
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-[calc(6.5rem_+_env(safe-area-inset-bottom))] md:pb-6">
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

      {/* 移动端底部导航（APP 式，含安全区） */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 pb-[env(safe-area-inset-bottom)]">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = view === n.key || (n.key === 'dashboard' && view === 'review')
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition ${
                  active ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
                aria-label={n.label}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-emerald-600" />}
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
