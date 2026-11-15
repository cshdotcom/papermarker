'use client'

import { useEffect, useState } from 'react'
import { Download, X, Shield, Wifi, CheckCircle2, Smartphone, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * PWA 安装引导 + 局域网权限说明
 *
 * Chrome 的 Private Network Access (PNA) 限制：
 *  - 从公网 HTTPS 页面访问 192.168.x.x 会被拦截
 *  - 安装为 PWA 后，Chrome 允许局域网访问（需一次性授权）
 *  - 该组件监听 beforeinstallprompt，显示安装按钮
 *  - 安装后引导用户授权局域网访问
 */
export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // 检测是否已安装（standalone 模式）
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    if (isStandalone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  // 注册 Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  if (installed || dismissed) return null

  // 有安装提示时显示横幅
  if (deferredPrompt) {
    return (
      <div className="fixed inset-x-0 bottom-20 z-50 mx-auto max-w-2xl px-4 md:bottom-4">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 shadow-lg">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Download className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900">安装 PaperMarker 应用</p>
            <p className="text-[11px] leading-tight text-emerald-700">
              安装后可访问局域网打印扫描设备（相机/扫描仪/打印机），不受浏览器限制
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              await deferredPrompt.prompt()
              const choice = await deferredPrompt.userChoice
              if (choice.outcome === 'accepted') setInstalled(true)
              setDeferredPrompt(null)
            }}
          >
            安装
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-1 text-emerald-700/50 hover:bg-emerald-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return null
}

/**
 * 局域网访问权限状态提示（安装在 standalone 模式后显示）
 */
export function LocalNetworkPermissionGuide() {
  const [show, setShow] = useState(false)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    // 检测是否已看过引导
    const seen = sessionStorage.getItem('pna_guide_seen')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStandalone(isStandalone)
    if (isStandalone && !seen) {
      setShow(true)
      sessionStorage.setItem('pna_guide_seen', '1')
    }
  }, [])

  if (!show || !standalone) return null

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 mx-auto max-w-2xl px-4 md:bottom-4">
      <div className="flex items-start gap-3 rounded-xl border border-sky-300 bg-sky-50 p-3 shadow-lg">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white">
          <Shield className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-sky-900">局域网设备访问授权</p>
          <p className="text-[11px] leading-relaxed text-sky-700">
            扫描仪/打印机在局域网内，首次访问时 Chrome 会弹窗请求授权。
            点击「允许」即可直接连接打印机（192.168.x.x），无需服务器中转。
          </p>
          <div className="flex flex-wrap gap-1 pt-1 text-[10px] text-sky-600">
            <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5">
              <Wifi className="h-3 w-3" /> 192.168.x.x
            </span>
            <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5">
              <CheckCircle2 className="h-3 w-3" /> 浏览器直连
            </span>
            <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5">
              <Smartphone className="h-3 w-3" /> 不经云端
            </span>
          </div>
        </div>
        <button
          onClick={() => setShow(false)}
          className="shrink-0 rounded p-1 text-sky-700/50 hover:bg-sky-100"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
