'use client'

import { useEffect, useState } from 'react'
import { Printer, FileText, Loader2, ExternalLink, FileCheck, FileQuestion, BookOpen, Layers, RefreshCw, Globe, X } from 'lucide-react'
import { api, fileUrl, type TaskDetail, type MarkLayers } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FlipGuide } from './flip-guide'

type SubType = 'mark' | 'marks' | 'answer' | 'parse'

const SUB_LABEL: Record<SubType, string> = {
  mark: '批注 PDF',
  marks: '标记层 PDF',
  answer: '答案 PDF',
  parse: '解析 PDF',
}

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

/**
 * 浏览器直接打印预览层：
 * 按图层渲染好的批注页（图片）逐页展示 → window.print() 走系统打印。
 * 不依赖服务器与打印机同局域网 —— 任何网络环境都能打印。
 */
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
          <div key={p.pageNo} className="bg-white print:block" style={{ breakAfter: i < pages.length - 1 ? 'page' : 'auto' }}>
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

export function PrintPanel({ task }: { task: TaskDetail }) {
  const [duplex, setDuplex] = useState(false)
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState<SubType | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  // 浏览器直接打印（mark=带原图；marks=纯标记层）
  const [webPrint, setWebPrint] = useState<'mark' | 'marks' | null>(null)
  const [webPages, setWebPages] = useState<{ pageNo: number; dataUrl: string }[]>([])
  const { layers, setLayers, toggleLayer } = usePm()
  const { toast } = useToast()

  const fileIds: Record<SubType, string | undefined> = {
    mark: task.markPdfFileId,
    marks: task.marksPdfFileId,
    answer: task.answerPdfFileId,
    parse: task.parsePdfFileId,
  }

  const openPdf = (id: string) => window.open(fileUrl(id), '_blank')

  // 打印时锁定 body 滚动
  useEffect(() => {
    if (webPrint) document.body.classList.add('printing-lock')
    else document.body.classList.remove('printing-lock')
    return () => document.body.classList.remove('printing-lock')
  }, [webPrint])

  /** 按当前图层重新生成四类 PDF */
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

  /** 浏览器直接打印：渲染批注页 → 全屏预览 → 系统打印对话框 */
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

  const doPrint = async (sub: SubType) => {
    setBusy(sub)
    try {
      const fid = fileIds[sub]
      if (!fid) {
        toast({ title: 'PDF 尚未生成', variant: 'destructive' })
        return
      }
      const r = await api.print({
        taskId: task.id,
        subType: sub,
        duplex,
        copies,
        layers,
      }).catch((e) => e)

      // 服务端 IPP/直连失败 → 返回 fallbackPdfFileId，走浏览器打印
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4 text-emerald-600" />
          打印下发
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 标记内容图层（错因/答案默认开，可调整） */}
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

        {/* 浏览器直接打印（推荐，不依赖局域网） */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <Globe className="h-3.5 w-3.5" />
            浏览器直接打印（推荐 · 任何网络可用）
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            按当前图层把批注页渲染成图片，用系统打印对话框打印 —— 手机 / 电脑 / 任何打印机都支持
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => doBrowserPrint('mark')}
              disabled={busy !== null}
              className="bg-emerald-600 hover:bg-emerald-700"
              size="sm"
            >
              {busy === 'mark' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileCheck className="mr-1 h-4 w-4" />}
              带原卷批注
            </Button>
            <Button
              onClick={() => doBrowserPrint('marks')}
              disabled={busy !== null}
              variant="secondary"
              className="bg-amber-600 text-white hover:bg-amber-700"
              size="sm"
            >
              {busy === 'marks' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Layers className="mr-1 h-4 w-4" />}
              纯标记层
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-lg border p-2.5">
            <Label htmlFor="duplex" className="text-xs">双面打印</Label>
            <Switch id="duplex" checked={duplex} onCheckedChange={setDuplex} />
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-2.5">
            <Label htmlFor="copies" className="text-xs whitespace-nowrap">份数</Label>
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

        {/* 网络直连打印（同局域网） */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Printer className="h-3.5 w-3.5" />
            网络直连打印（需与打印机同一局域网）
          </div>
          <Button
            onClick={() => doPrint('mark')}
            disabled={busy !== null}
            variant="outline"
            className="w-full"
          >
            {busy === 'mark' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
            直连打印批注 PDF
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={() => doPrint('marks')} disabled={busy !== null} variant="outline" size="sm">
              {busy === 'marks' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Layers className="mr-1 h-3.5 w-3.5" />}
              标记层
            </Button>
            <Button onClick={() => doPrint('answer')} disabled={busy !== null} variant="outline" size="sm">
              {busy === 'answer' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileQuestion className="mr-1 h-3.5 w-3.5" />}
              答案
            </Button>
            <Button onClick={() => doPrint('parse')} disabled={busy !== null} variant="outline" size="sm">
              {busy === 'parse' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1 h-3.5 w-3.5" />}
              解析
            </Button>
          </div>
        </div>

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
