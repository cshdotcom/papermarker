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
} from 'lucide-react'
import { api, fileUrl, type ScannerConfig, type TrayPage } from '@/lib/pm'
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

  // 网络扫描仪取页
  const doScan = async () => {
    if (!scannerCfg) return
    setScanning(true)
    try {
      const r = await api.esclScan({
        source: scannerCfg.source,
        colorMode: scannerCfg.colorMode,
        dpi: scannerCfg.dpi,
      })
      setPages((ps) => [...ps, ...r.pages.map((p) => ({ ...p }))])
      toast({ title: r.msg, description: `来源：${scannerCfg.source === 'Feeder' ? '送稿器' : '平板'}` })
    } catch (e: any) {
      toast({ title: '扫描失败', description: e.message, variant: 'destructive' })
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

  // 提交 AI 批改（多页任务）
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
        description: `共 ${r.summary.questionCount} 题，AI 判分 ${r.summary.totalGet}/${r.summary.totalFull}`,
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

  // 快速复印：托盘页面下发打印机（IPP / Brother 9100 直连）
  const doCopy = async () => {
    if (pages.length === 0) {
      toast({ title: '托盘没有页面，请先扫描或拍照', variant: 'destructive' })
      return
    }
    setCopying(true)
    try {
      const r = await api.copyPrint({
        fileIds: pages.map((p) => p.id),
        duplex: copyDuplex,
      })
      if (r?.code === 500 && (r as any).fallbackPdfFileId) {
        toast({
          title: 'IPP 打印失败，已切换浏览器打印',
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
              复印 = 托盘页面下发打印机（IPP 631 或 Brother 9100 直连）；失败自动降级浏览器打印
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
