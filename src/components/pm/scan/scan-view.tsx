'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ScanLine,
  Camera,
  Printer,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
  Copy,
  FileStack,
  AlertCircle,
  Wifi,
  Download,
} from 'lucide-react'
import { api, fileUrl, type ScannerConfig, type TrayPage } from '@/lib/pm'
import { clientEsclScan } from '@/lib/client/escl-scan'
import { detectBridge, bridgeScan, bridgePrint, base64ToBlob } from '@/lib/client/brother-bridge'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CameraCapture } from './camera-capture'
import { CornerEditor } from './corner-editor'

interface TrayItem extends TrayPage {
  localUrl?: string
}

/**
 * 扫描页（APP 端核心）：
 *  - 手机模式：相机连续拍摄 → 每页四角调节（自动检测+透视矫正+增强）→ 上传托盘
 *  - 扫描仪模式：eSCL 通用（8095）或 Brother 私有协议（54921）直接取页入托盘
 *  - 托盘：排序/删除 → 开始 AI 批改（多页任务）/ 快速复印（IPP / 9100 直连）
 */
export function ScanView() {
  const isMobile = useIsMobile()
  const { openTask } = usePm()
  const consumePendingScanFiles = usePm((s) => s.consumePendingScanFiles)
  const { toast } = useToast()

  const [mode, setMode] = useState<'camera' | 'scanner'>('scanner')
  const [pages, setPages] = useState<TrayItem[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [paperName, setPaperName] = useState('')
  const [studentName, setStudentName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyDuplex, setCopyDuplex] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannerCfg, setScannerCfg] = useState<ScannerConfig | null>(null)

  useEffect(() => {
    setMode(isMobile ? 'camera' : 'scanner')
  }, [isMobile])

  // 消费全局待剪辑队列（Dashboard 拍照/选图 → 跳到本页 → 弹出四角剪辑器）
  useEffect(() => {
    const queued = consumePendingScanFiles()
    if (queued.length > 0) {
      setPendingFiles((q) => [...q, ...queued])
    }
  }, [])

  // 载入托盘 + 扫描仪配置
  const loadTray = useCallback(async () => {
    try {
      const r = await api.listTrayPages()
      setPages(r.pages.map((p) => ({ ...p })))
    } catch {}
  }, [])

  useEffect(() => {
    loadTray()
    api
      .getScanner()
      .then((r) => setScannerCfg(r.config))
      .catch(() => {})
  }, [loadTray])

  // 拍照 / 选图 → 进入编辑队列
  const onCaptured = (file: File) => {
    setPendingFiles((q) => [...q, file])
  }

  // 编辑完成 → 上传托盘
  const onEdited = async (blob: Blob) => {
    setPendingFiles((q) => q.slice(1))
    try {
      const r = await api.uploadTrayPage(blob)
      setPages((ps) => [
        ...ps,
        { id: r.page.id, url: r.page.url, w: r.page.w, h: r.page.h },
      ])
      toast({ title: '已加入扫描托盘' })
    } catch (e: any) {
      toast({ title: '页面上传失败', description: e.message, variant: 'destructive' })
    }
  }

  const onEditCancel = () => {
    setPendingFiles((q) => q.slice(1))
  }

  // 网络扫描仪取页（客户端直连，不经服务器）
  const doScan = async () => {
    if (!scannerCfg) return
    setScanning(true)
    setScanError(null)

    // Brother 54921 裸 TCP：浏览器无法直连，通过本地桥接服务中转
    if (scannerCfg.protocol === 'brother') {
      if (!scannerCfg.host) {
        setScanning(false)
        setScanError('请先在设置中配置 Brother 打印机 IP')
        return
      }
      // 探测本地桥接是否运行
      const bridge = await detectBridge()
      if (!bridge.running) {
        setScanning(false)
        setScanError(
          'Brother 54921 私有协议是裸 TCP，浏览器无法直连。\n\n' +
            '解决方法（二选一）：\n' +
            '① 下载并运行「Windows 桥接服务」（本页顶部有下载链接），双击运行后网页自动连打印机\n' +
            '② 改用手机相机拍照（功能等价，无需局域网）'
        )
        return
      }
      // 通过桥接服务扫描
      try {
        const colorMap: Record<string, string> = {
          RGB24: 'C256',
          Grayscale8: 'CGRAY',
          BlackAndWhite1: 'TEXT',
        }
        const r = await bridgeScan(scannerCfg.host, {
          dpi: scannerCfg.dpi,
          colorMode: colorMap[scannerCfg.colorMode] || 'CGRAY',
          source: scannerCfg.source,
        })
        if (!r.ok || r.pages.length === 0) {
          setScanning(false)
          setScanError(r.msg || '扫描未获取到页面')
          return
        }
        // base64 → Blob → 上传托盘
        const uploadedPages: TrayItem[] = []
        for (const p of r.pages) {
          try {
            const blob = base64ToBlob(p.base64)
            const up = await api.uploadTrayPage(blob)
            uploadedPages.push({ id: up.page.id, url: up.page.url, w: up.page.w, h: up.page.h })
          } catch (e: any) {
            toast({ title: '页面上传失败', description: e.message, variant: 'destructive' })
          }
        }
        if (uploadedPages.length > 0) {
          setPages((ps) => [...ps, ...uploadedPages])
          toast({
            title: r.msg,
            description: `来源：${scannerCfg.source === 'Feeder' ? '送稿器' : '平板'}（经本地桥接）`,
          })
        }
      } catch (e: any) {
        setScanError(`桥接扫描失败：${e.message}`)
      } finally {
        setScanning(false)
      }
      return
    }

    // eSCL 是 HTTP 协议，浏览器可直连（需打印机支持 CORS）
    try {
      const r = await clientEsclScan(scannerCfg.esclUrl, {
        source: scannerCfg.source,
        colorMode: scannerCfg.colorMode,
        dpi: scannerCfg.dpi,
      })
      if (!r.ok) {
        setScanError(r.msg)
        toast({ title: '扫描失败', description: r.msg, variant: 'destructive' })
        return
      }
      // 客户端扫描的页面是 Blob，需上传到服务器托盘存储
      const uploadedPages: TrayItem[] = []
      for (const p of r.pages) {
        try {
          const up = await api.uploadTrayPage(p.blob)
          uploadedPages.push({ id: up.page.id, url: up.page.url, w: up.page.w, h: up.page.h })
          URL.revokeObjectURL(p.url) // 释放 object URL
        } catch (e: any) {
          toast({ title: '页面上传失败', description: e.message, variant: 'destructive' })
        }
      }
      if (uploadedPages.length > 0) {
        setPages((ps) => [...ps, ...uploadedPages])
        toast({
          title: r.msg,
          description: `来源：${scannerCfg.source === 'Feeder' ? '送稿器' : '平板'}`,
        })
      }
    } catch (e: any) {
      const msg = e.message || '未知错误'
      setScanError(msg)
      toast({ title: '扫描失败', description: msg, variant: 'destructive' })
    } finally {
      setScanning(false)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    setPages((ps) => {
      const j = i + dir
      if (j < 0 || j >= ps.length) return ps
      const next = [...ps]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const remove = async (id: string) => {
    setPages((ps) => ps.filter((p) => p.id !== id))
    try {
      await api.deleteTrayPage(id)
    } catch {}
  }

  // 提交 AI 批改（异步批改 v2：上传成功即返回，后台批改）
  const submit = async () => {
    if (pages.length === 0) {
      toast({ title: '托盘没有页面，请先扫描或拍照', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const r = await api.createTaskFromPages(
        pages.map((p) => p.id),
        paperName || '未命名试卷',
        studentName
      )
      toast({
        title: `已创建 ${r.summary.pageCount} 页批改任务`,
        description: 'AI 正在后台批改，进入任务可查看进度',
      })
      setPaperName('')
      setStudentName('')
      setPages([])
      openTask(r.taskId)
    } catch (e: any) {
      toast({ title: '创建任务失败', description: e.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  // 快速复印：托盘页面下发打印机
  // Brother 模式：浏览器 → localhost 桥接 → TCP 9100（不经服务器）
  // eSCL/IPP 模式：走服务器（仅自托管可用）
  const doCopy = async () => {
    if (pages.length === 0) {
      toast({ title: '托盘没有页面，请先扫描或拍照', variant: 'destructive' })
      return
    }
    setCopying(true)
    try {
      // Brother 模式：优先走本地桥接
      if (scannerCfg?.protocol === 'brother' && scannerCfg.host) {
        const bridge = await detectBridge()
        if (bridge.running) {
          // 托盘页面 → 获取 JPEG → base64 → 桥接打印
          const jpegs: string[] = []
          for (const p of pages) {
            try {
              const resp = await fetch(fileUrl(p.id))
              const blob = await resp.blob()
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => resolve(reader.result as string)
                reader.readAsDataURL(blob)
              })
              jpegs.push(base64.split(',')[1])
            } catch (e: any) {
              toast({ title: '获取托盘页失败', description: e.message, variant: 'destructive' })
            }
          }
          if (jpegs.length === 0) {
            toast({ title: '无可打印页面', variant: 'destructive' })
            return
          }
          const result = await bridgePrint(scannerCfg.host, jpegs, 'PaperMarker-Copy')
          if (result.ok) {
            toast({ title: '复印已下发（经本地桥接）', description: result.msg })
          } else {
            toast({ title: '桥接复印失败', description: result.msg, variant: 'destructive' })
          }
          return
        } else {
          toast({
            title: '本地桥接未运行',
            description: '请下载并运行 papermarker-bridge.exe，或改用服务器复印（需自托管）',
            variant: 'destructive',
          })
          return
        }
      }

      // 非 Brother 模式：走服务器
      const r = await api.copyPrint({
        fileIds: pages.map((p) => p.id),
        duplex: copyDuplex,
      })
      if (r?.code === 500 && (r as any).fallbackPdfFileId) {
        toast({
          title: '打印失败，已切换浏览器打印',
          description: (r as any).msg,
          variant: 'destructive',
        })
        window.open(fileUrl((r as any).fallbackPdfFileId), '_blank')
        return
      }
      if (r?.code === 200) {
        toast({ title: '复印已下发', description: r.msg })
      } else {
        toast({ title: '复印失败', description: r?.msg || '未知错误', variant: 'destructive' })
      }
    } catch (e: any) {
      toast({ title: '复印失败', description: e.message, variant: 'destructive' })
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 左：采集 */}
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500" aria-hidden />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScanLine className="h-4 w-4 text-emerald-600" />
                  扫描采集
                </CardTitle>
                <CardDescription>
                  手机相机拍照矫正，或网络扫描仪（eSCL / Brother 54921）直接取页
                </CardDescription>
              </div>
              <div className="flex rounded-lg border p-0.5">
                <button
                  onClick={() => setMode('camera')}
                  className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition ${
                    mode === 'camera' ? 'bg-emerald-600 text-white' : 'text-muted-foreground'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" />
                  手机相机
                </button>
                <button
                  onClick={() => setMode('scanner')}
                  className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition ${
                    mode === 'scanner' ? 'bg-emerald-600 text-white' : 'text-muted-foreground'
                  }`}
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  网络扫描仪
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mode === 'camera' ? (
              <CameraCapture
                onCapture={onCaptured}
                pageCount={pages.length}
                onDone={() => toast({ title: '拍摄完成，可提交批改或继续扫描' })}
              />
            ) : (
              <div className="space-y-3">
                {/* 客户端直连说明：浏览器直接连扫描仪，不经服务器 */}
                <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                    <div className="space-y-1">
                      <p className="font-semibold text-sky-800">浏览器直连扫描仪（不经服务器）</p>
                      {scannerCfg?.protocol === 'brother' ? (
                        <>
                          <p className="leading-relaxed text-sky-700">
                            Brother 54921 是裸 TCP 协议，浏览器无法直连。
                            下载并运行桥接服务后，网页自动通过 localhost 连打印机。
                          </p>
                          <a
                            href="/papermarker-bridge.exe"
                            download="papermarker-bridge.exe"
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-700"
                          >
                            <Download className="h-3 w-3" />
                            下载 Windows 桥接（双击运行）
                          </a>
                          <p className="text-[10px] text-sky-600">
                            下载后双击运行，保持窗口打开即可。无需安装任何环境。
                          </p>
                        </>
                      ) : (
                        <p className="leading-relaxed text-sky-700">
                          扫描请求由浏览器直接发往你局域网内的扫描仪，不经云端服务器。
                          需要扫描仪支持 CORS（佳能/惠普多数支持，兄弟/爱普生多数不支持）。
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 h-7 border-sky-400 text-sky-700 hover:bg-sky-100"
                        onClick={() => setMode('camera')}
                      >
                        <Camera className="mr-1 h-3.5 w-3.5" />
                        切换到手机相机
                      </Button>
                    </div>
                  </div>
                </div>
                {scannerCfg ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">进纸源</Label>
                        <Select
                          value={scannerCfg.source}
                          onValueChange={(v) => setScannerCfg({ ...scannerCfg, source: v })}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Platen">平板</SelectItem>
                            <SelectItem value="Feeder">送稿器</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">色彩</Label>
                        <Select
                          value={scannerCfg.colorMode}
                          onValueChange={(v) => setScannerCfg({ ...scannerCfg, colorMode: v })}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {scannerCfg.protocol === 'brother' ? (
                              <>
                                <SelectItem value="Grayscale8">灰度</SelectItem>
                                <SelectItem value="RGB24">彩色</SelectItem>
                                <SelectItem value="BlackAndWhite1">黑白</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="RGB24">彩色</SelectItem>
                                <SelectItem value="Grayscale8">灰度</SelectItem>
                                <SelectItem value="BlackAndWhite1">黑白</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">分辨率</Label>
                        <Select
                          value={String(scannerCfg.dpi)}
                          onValueChange={(v) => setScannerCfg({ ...scannerCfg, dpi: Number(v) })}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(scannerCfg.protocol === 'brother'
                              ? [100, 200, 300, 600]
                              : [150, 200, 300]
                            ).map((d) => (
                              <SelectItem key={d} value={String(d)}>
                                {d} dpi
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {scannerCfg.protocol === 'brother' ? (
                        <>Brother {scannerCfg.host || '未配置 IP'}（私有协议 54921 · 扫描前退出 iPrint&Scan）</>
                      ) : (
                        <>{scannerCfg.esclUrl}（可在设置页修改并测试连通）</>
                      )}
                    </p>
                    <Button
                      onClick={doScan}
                      disabled={scanning}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                    >
                      {scanning ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          正在扫描，请稍候…
                        </>
                      ) : (
                        <>
                          <ScanLine className="mr-2 h-4 w-4" />
                          开始扫描
                        </>
                      )}
                    </Button>
                    {scanError && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                        <div className="flex items-center gap-1 font-semibold">
                          <AlertCircle className="h-3.5 w-3.5" />
                          扫描失败
                        </div>
                        <p className="mt-1 whitespace-pre-line leading-relaxed">{scanError}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 border-amber-400 text-amber-700 hover:bg-amber-100"
                          onClick={() => setMode('camera')}
                        >
                          <Camera className="mr-1 h-3.5 w-3.5" />
                          改用手机相机拍照
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 右：托盘 + 提交 */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileStack className="h-4 w-4 text-emerald-600" />
              扫描托盘（{pages.length} 页）
            </CardTitle>
            <CardDescription>拖动箭头排序，X 删除；顺序即试卷页码</CardDescription>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <div className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed py-10 text-muted-foreground">
                <img
                  src="/scan-illustration.png"
                  alt=""
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 hidden h-full object-cover opacity-15 sm:block"
                />
                <FileStack className="h-8 w-8 opacity-40" />
                <p className="text-sm font-medium text-foreground/70">暂无扫描页</p>
                <p className="max-w-[240px] text-center text-xs">
                  拍摄或扫描的页面会出现在这里；逐页四角矫正后提交 AI 批改
                </p>
              </div>
            ) : (
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {pages.map((p, i) => (
                  <div key={p.id} className="group relative overflow-hidden rounded-md border bg-muted/40">
                    <img src={fileUrl(p.id)} alt={`第${i + 1}页`} className="h-28 w-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      第 {i + 1} 页
                    </span>
                    <div className="absolute right-1 top-1 flex gap-0.5">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="rounded bg-black/60 p-1 text-white transition hover:bg-black/80 disabled:opacity-30"
                        aria-label="前移"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === pages.length - 1}
                        className="rounded bg-black/60 p-1 text-white transition hover:bg-black/80 disabled:opacity-30"
                        aria-label="后移"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="rounded bg-red-600/80 p-1 text-white transition hover:bg-red-600"
                        aria-label="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">试卷名称</Label>
                <Input
                  value={paperName}
                  onChange={(e) => setPaperName(e.target.value)}
                  placeholder="例：数学单元测验"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">学生姓名</Label>
                <Input
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="可选"
                  className="h-9"
                />
              </div>
            </div>

            <Button
              onClick={submit}
              disabled={submitting || pages.length === 0}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  AI 批改中…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  开始 AI 批改（{pages.length} 页）
                </>
              )}
            </Button>

            <div className="flex items-center gap-2 rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-muted-foreground" />
                <Label className="text-xs whitespace-nowrap">双面</Label>
                <Switch checked={copyDuplex} onCheckedChange={setCopyDuplex} />
              </div>
              <Button
                onClick={doCopy}
                disabled={copying || pages.length === 0}
                variant="outline"
                className="ml-auto"
              >
                {copying ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                快速复印
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {scannerCfg?.protocol === 'brother'
                ? '复印 = 托盘页面经本地桥接下发 Brother 打印机 9100；需运行桥接服务'
                : '复印 = 托盘页面下发打印机（IPP 631，需自托管）；失败自动降级浏览器打印'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 四角编辑浮层（逐张弹出） */}
      {pendingFiles.length > 0 && (
        <CornerEditor
          file={pendingFiles[0]}
          index={pages.length}
          total={pages.length + pendingFiles.length}
          onDone={onEdited}
          onCancel={onEditCancel}
        />
      )}
    </div>
  )
}
