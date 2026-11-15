'use client'

import { useEffect, useState } from 'react'
import {
  Printer,
  FileText,
  Loader2,
  ExternalLink,
  FileCheck,
  FileQuestion,
  BookOpen,
  Layers,
  RefreshCw,
  Globe,
  X,
  Server,
  Wifi,
  Monitor,
  Smartphone,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { api, fileUrl, type TaskDetail, type MarkLayers, type PrinterConfig } from '@/lib/pm'
import { detectBridge, bridgePrint } from '@/lib/client/brother-bridge'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { FlipGuide } from './flip-guide'

type SubType = 'mark' | 'marks' | 'answer' | 'parse'

const SUB_LABEL: Record<SubType, string> = {
  mark: '批注 PDF',
  marks: '标记层 PDF',
  answer: '答案 PDF',
  parse: '解析 PDF',
}

const CONTENT_OPTIONS: {
  key: SubType
  label: string
  desc: string
  icon: any
}[] = [
  { key: 'mark', label: '批注卷', desc: '原图 + 勾叉 + 答案 + 错因', icon: FileCheck },
  { key: 'marks', label: '纯标记层', desc: '透明底，只保留批注标记', icon: Layers },
  { key: 'answer', label: '答案汇总', desc: '纯文字答案页', icon: FileQuestion },
  { key: 'parse', label: '解析汇总', desc: '纯文字解析页', icon: BookOpen },
]

type PrintMethod = 'browser' | 'ipp' | 'brother'

const METHOD_OPTIONS: {
  key: PrintMethod
  label: string
  desc: string
  icon: any
  hint: string
  warning?: string
}[] = [
  {
    key: 'browser',
    label: '浏览器打印',
    desc: '渲染图片 → 系统打印对话框 → 选本机打印机',
    icon: Globe,
    hint: '客户端直接打印，任何网络可用，手机/电脑都支持（推荐）',
  },
  {
    key: 'ipp',
    label: 'IPP 网络直连',
    desc: 'IPP 协议 → 打印机 631 端口',
    icon: Server,
    hint: '佳能/惠普/兄弟通用，需服务器与打印机同局域网',
    warning: '当前服务器在云端，无法访问局域网打印机。仅当应用自托管（服务器与打印机同网）时可用。',
  },
  {
    key: 'brother',
    label: 'Brother 桥接打印',
    desc: '浏览器 → localhost 桥接 → 打印机 9100',
    icon: Wifi,
    hint: 'Brother DCP-T428W 喷墨机专用，需本电脑运行桥接服务',
    warning: '需先下载并运行 papermarker-bridge.exe（扫描页有下载链接）。桥接运行后浏览器经 localhost 直连打印机 9100，不经服务器。',
  },
]

/** 可调图层（标记层/批注共用，错因+答案默认开） */
const LAYER_ITEMS: { key: keyof MarkLayers; label: string; hint?: string }[] = [
  { key: 'marks', label: '判分标记（√ × 半勾）' },
  { key: 'scores', label: '得分' },
  { key: 'answers', label: '答案回填' },
  { key: 'reason', label: '错因（错在哪步）' },
  { key: 'solution', label: '完整解析' },
  { key: 'boxes', label: '题框' },
  { key: 'banner', label: '顶部分数条' },
]

/** 浏览器直接打印预览层 */
function BrowserPrintOverlay({
  pages,
  onClose,
}: {
  pages: { pageNo: number; dataUrl: string }[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[90] overflow-auto bg-black/85 p-4 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          body.printing-lock { overflow: visible !important; }
          body.printing-lock * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute !important; left: 0; top: 0; width: 100% !important; }
          .no-print { display: none !important; }
          @page { margin: 6mm; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white/95 p-3 shadow-lg">
        <Printer className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium">共 {pages.length} 页 · 检查预览后点击打印</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="mr-1 h-3.5 w-3.5" /> 关闭
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => window.print()}>
            <Printer className="mr-1 h-3.5 w-3.5" /> 打印
          </Button>
        </div>
      </div>
      <div className="print-area mx-auto max-w-[820px] space-y-3 print:max-w-none print:space-y-0">
        {pages.map((p, i) => (
          <div
            key={p.pageNo}
            className="bg-white print:block"
            style={{ breakAfter: i < pages.length - 1 ? 'page' : 'auto' }}
          >
            <img
              src={p.dataUrl}
              alt={`第${p.pageNo}页`}
              className="w-full rounded shadow-lg print:rounded-none print:shadow-none"
              draggable={false}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 打印流程示意图 */
function PrintFlowDiagram({ method }: { method: PrintMethod }) {
  const steps =
    method === 'browser'
      ? [
          { icon: Monitor, label: '本设备', sub: '浏览器' },
          { icon: Globe, label: '渲染图片', sub: '系统打印框' },
          { icon: Printer, label: '任意打印机', sub: '本地/网络' },
        ]
      : method === 'ipp'
      ? [
          { icon: Smartphone, label: '本设备', sub: '网页端' },
          { icon: Server, label: 'IPP 协议', sub: '631 端口' },
          { icon: Printer, label: '局域网打印机', sub: '佳能/惠普等' },
        ]
      : [
          { icon: Smartphone, label: '本设备', sub: '网页端' },
          { icon: Wifi, label: '本地桥接', sub: 'localhost:3790' },
          { icon: Printer, label: 'Brother 打印机', sub: 'TCP 9100' },
        ]
  return (
    <div className="flex items-center justify-between gap-1 rounded-lg border bg-muted/30 p-3">
      {steps.map((s, i) => {
        const Icon = s.icon
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-0.5 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-[11px] font-semibold leading-tight">{s.label}</div>
              <div className="text-[9px] text-muted-foreground leading-tight">{s.sub}</div>
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PrintPanel({ task }: { task: TaskDetail }) {
  const [duplex, setDuplex] = useState(false)
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState<SubType | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [webPrint, setWebPrint] = useState<'mark' | 'marks' | null>(null)
  const [webPages, setWebPages] = useState<{ pageNo: number; dataUrl: string }[]>([])
  // 打印对话框状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [chosenContent, setChosenContent] = useState<SubType>('mark')
  const [chosenMethod, setChosenMethod] = useState<PrintMethod>('browser')
  const [printerCfg, setPrinterCfg] = useState<PrinterConfig | null>(null)
  const [bridgeRunning, setBridgeRunning] = useState<boolean | null>(null)
  const { layers, toggleLayer } = usePm()
  const { toast } = useToast()

  // 加载打印机配置（判断 Brother host + mode）
  useEffect(() => {
    api.getPrinter().then((r) => setPrinterCfg(r.config)).catch(() => {})
  }, [])

  // 打印对话框打开时探测桥接状态
  useEffect(() => {
    if (dialogOpen && printerCfg?.mode === 'brother') {
      detectBridge().then((b) => setBridgeRunning(b.running))
    }
  }, [dialogOpen, printerCfg?.mode])

  const fileIds: Record<SubType, string | undefined> = {
    mark: task.markPdfFileId,
    marks: task.marksPdfFileId,
    answer: task.answerPdfFileId,
    parse: task.parsePdfFileId,
  }

  const openPdf = (id: string) => window.open(fileUrl(id), '_blank')

  useEffect(() => {
    if (webPrint) document.body.classList.add('printing-lock')
    else document.body.classList.remove('printing-lock')
    return () => document.body.classList.remove('printing-lock')
  }, [webPrint])

  const regenerate = async () => {
    setRegenerating(true)
    try {
      await api.generatePdf(task.id, layers)
      toast({ title: 'PDF 已按当前图层重新生成' })
    } catch (e: any) {
      toast({ title: '生成失败', description: e.message, variant: 'destructive' })
    } finally {
      setRegenerating(false)
    }
  }

  const doBrowserPrint = async (sub: 'mark' | 'marks') => {
    setBusy(sub)
    try {
      const r = await api.printPages(task.id, sub === 'mark', layers)
      if (!r.pages || r.pages.length === 0) {
        toast({ title: '没有可打印的页面', variant: 'destructive' })
        return
      }
      setWebPages(r.pages)
      setWebPrint(sub)
    } catch (e: any) {
      toast({ title: '渲染打印页失败', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const doDirectPrint = async (sub: SubType) => {
    setBusy(sub)
    try {
      const fid = fileIds[sub]
      if (!fid) {
        toast({ title: 'PDF 尚未生成，请先点击「重新生成 PDF」', variant: 'destructive' })
        return
      }
      const r = await api
        .print({
          taskId: task.id,
          subType: sub,
          duplex,
          copies,
          layers,
        })
        .catch((e) => e)

      if (r?.code === 500 && r.fallbackPdfFileId) {
        toast({
          title: '直连打印失败，已切换浏览器打印',
          description: r.msg,
          variant: 'destructive',
        })
        openPdf(r.fallbackPdfFileId)
        return
      }
      if (r?.fallback) {
        openPdf(fid)
        toast({ title: '已打开 PDF，请使用浏览器打印' })
        return
      }
      if (r?.code === 200) {
        toast({ title: `${SUB_LABEL[sub]} 打印成功`, description: r.msg })
      } else {
        toast({ title: '打印失败', description: r?.msg || '未知错误', variant: 'destructive' })
      }
    } finally {
      setBusy(null)
    }
  }

  /** Brother 桥接直连打印：浏览器 → localhost:3790 → TCP 9100（不经服务器） */
  const doBridgePrint = async (sub: SubType) => {
    setBusy(sub)
    try {
      const host = printerCfg?.host
      if (!host) {
        toast({ title: '请先在设置中配置 Brother 打印机 IP', variant: 'destructive' })
        return
      }
      // 探测桥接是否运行
      const bridge = await detectBridge()
      if (!bridge.running) {
        toast({
          title: '本地桥接未运行',
          description: '请下载并运行 papermarker-bridge.exe（扫描页有下载链接），或改用浏览器打印',
          variant: 'destructive',
        })
        return
      }
      // 获取渲染后的批注页 JPEG（dataUrl）
      const withImage = sub === 'mark' || sub === 'marks'
      const subForRender = sub === 'answer' || sub === 'parse' ? 'mark' : sub
      const r = await api.printPages(task.id, withImage, layers)
      if (!r.pages || r.pages.length === 0) {
        toast({ title: '没有可打印的页面', variant: 'destructive' })
        return
      }
      // dataUrl → base64（去掉 data:image/jpeg;base64, 前缀）
      const jpegs = r.pages.map((p) => p.dataUrl.split(',')[1])
      // 按份数复制
      const allJpegs: string[] = []
      for (let i = 0; i < copies; i++) allJpegs.push(...jpegs)

      const result = await bridgePrint(host, allJpegs, `PaperMarker-${subForRender}`)
      if (result.ok) {
        toast({ title: `${SUB_LABEL[sub]} 桥接打印成功`, description: result.msg })
      } else {
        toast({
          title: '桥接打印失败',
          description: result.msg,
          variant: 'destructive',
        })
      }
    } catch (e: any) {
      toast({ title: '桥接打印异常', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  /** 确认打印：按所选方式分发 */
  const confirmPrint = async () => {
    setDialogOpen(false)
    if (chosenMethod === 'browser') {
      // 浏览器打印只支持 mark / marks
      await doBrowserPrint(chosenContent === 'answer' || chosenContent === 'parse' ? 'mark' : chosenContent)
    } else if (chosenMethod === 'brother') {
      // Brother 直连：必须走本地桥接（不经服务器）
      const bridge = await detectBridge()
      if (bridge.running && printerCfg?.host) {
        await doBridgePrint(chosenContent)
      } else if (!bridge.running) {
        // 桥接未运行 → 不降级服务器，明确提示
        toast({
          title: '本地桥接未运行',
          description: 'Brother 打印需要本地桥接服务。请下载运行 papermarker-bridge.exe，或改用浏览器打印',
          variant: 'destructive',
        })
      } else {
        toast({ title: '请先在设置中配置 Brother 打印机 IP', variant: 'destructive' })
      }
    } else {
      // IPP：只能走服务器（需自托管）
      await doDirectPrint(chosenContent)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4 text-emerald-600" />
          打印下发
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 标记内容图层 */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Layers className="h-3.5 w-3.5 text-emerald-600" />
              打印内容图层
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={regenerate}
              disabled={regenerating}
              className="h-7 px-2 text-[11px]"
            >
              {regenerating ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              重新生成 PDF
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {LAYER_ITEMS.map((it) => (
              <label
                key={it.key}
                className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 text-[11px] transition hover:bg-muted/60"
                onClick={(e) => {
                  e.preventDefault()
                  toggleLayer(it.key)
                }}
              >
                <span className={layers[it.key] ? 'text-foreground' : 'text-muted-foreground'}>
                  {it.label}
                </span>
                <Switch
                  checked={layers[it.key]}
                  onCheckedChange={() => toggleLayer(it.key)}
                  className="scale-90"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            错因与答案默认开启；打印/重新生成时按当前开关生效（练习名 · 学生得分 · 打印日期在分数条中）。
          </p>
        </div>

        {/* 双面 / 份数 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg border p-2.5">
            <Label htmlFor="duplex" className="text-xs">
              双面打印
            </Label>
            <Switch id="duplex" checked={duplex} onCheckedChange={setDuplex} />
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-2.5">
            <Label htmlFor="copies" className="whitespace-nowrap text-xs">
              份数
            </Label>
            <Input
              id="copies"
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
              className="h-7 w-16 text-sm"
            />
          </div>
        </div>

        {duplex && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <FlipGuide />
          </div>
        )}

        {/* 主打印按钮：打开选择对话框 */}
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={busy !== null}
          className="w-full bg-emerald-600 text-base hover:bg-emerald-700"
          size="lg"
        >
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Printer className="mr-2 h-5 w-5" />}
          开始打印
        </Button>

        {/* PDF 浏览 / 下载 */}
        <div className="border-t pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            PDF 浏览 / 下载
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['mark', 'marks', 'answer', 'parse'] as SubType[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="ghost"
                disabled={!fileIds[s]}
                onClick={() => fileIds[s] && openPdf(fileIds[s]!)}
                className="text-xs"
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                {SUB_LABEL[s]}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>

      {/* 打印方式选择对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-emerald-600" />
              选择打印方式
            </DialogTitle>
            <DialogDescription>
              先选择打印内容，再选择打印方式。浏览器打印任何网络可用；直连打印需与打印机同一局域网。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 步骤 1：打印内容 */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">
                ① 打印内容
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {CONTENT_OPTIONS.map((c) => {
                  const Icon = c.icon
                  const active = chosenContent === c.key
                  return (
                    <button
                      key={c.key}
                      onClick={() => setChosenContent(c.key)}
                      className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-muted hover:bg-muted/50'
                      }`}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          active ? 'text-emerald-600' : 'text-muted-foreground'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">{c.label}</div>
                        <div className="text-[10px] leading-tight text-muted-foreground">
                          {c.desc}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 步骤 2：打印方式 */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">
                ② 打印方式
              </Label>
              <div className="space-y-2">
                {METHOD_OPTIONS.map((m) => {
                  const Icon = m.icon
                  const active = chosenMethod === m.key
                  return (
                    <button
                      key={m.key}
                      onClick={() => setChosenMethod(m.key)}
                      className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                        active
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-muted hover:bg-muted/50'
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          active ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{m.label}</span>
                          {active && (
                            <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
                              已选
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                        <div className="text-[10px] text-muted-foreground/80">{m.hint}</div>
                        {m.warning && (
                          <div className="mt-1 flex items-start gap-1 rounded bg-amber-50 p-1.5 text-[10px] leading-tight text-amber-700 ring-1 ring-amber-200">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{m.warning}</span>
                          </div>
                        )}
                        {/* Brother 桥接状态指示器 */}
                        {m.key === 'brother' && bridgeRunning !== null && (
                          <div
                            className={`mt-1 flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
                              bridgeRunning
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                : 'bg-red-50 text-red-700 ring-1 ring-red-200'
                            }`}
                          >
                            {bridgeRunning ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                            {bridgeRunning ? '桥接已连接 ✓' : '桥接未运行 ✗ 点击下载'}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 步骤 3：流程示意图 */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">
                ③ 打印流程
              </Label>
              <PrintFlowDiagram method={chosenMethod} />
            </div>

            {/* 当前配置摘要 */}
            <div className="rounded-lg bg-muted/40 p-2.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  内容：<b className="text-foreground">{SUB_LABEL[chosenContent]}</b>
                </span>
                <span>
                  方式：<b className="text-foreground">{METHOD_OPTIONS.find((m) => m.key === chosenMethod)?.label}</b>
                </span>
                <span>
                  份数：<b className="text-foreground">{copies}</b>
                </span>
                <span>
                  双面：<b className="text-foreground">{duplex ? '是' : '否'}</b>
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={confirmPrint}
              disabled={busy !== null}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Printer className="mr-1 h-4 w-4" />}
              确认打印
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 浏览器直接打印预览 */}
      {webPrint && webPages.length > 0 && (
        <BrowserPrintOverlay
          pages={webPages}
          onClose={() => {
            setWebPrint(null)
            setWebPages([])
          }}
        />
      )}
    </Card>
  )
}
