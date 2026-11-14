'use client'

import { useState } from 'react'
import { Printer, FileText, Loader2, ExternalLink, FileCheck, FileQuestion, BookOpen, Layers } from 'lucide-react'
import { api, fileUrl, type TaskDetail } from '@/lib/pm'
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

export function PrintPanel({ task }: { task: TaskDetail }) {
  const [duplex, setDuplex] = useState(false)
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState<SubType | null>(null)
  const { toast } = useToast()

  const fileIds: Record<SubType, string | undefined> = {
    mark: task.markPdfFileId,
    marks: task.marksPdfFileId,
    answer: task.answerPdfFileId,
    parse: task.parsePdfFileId,
  }

  const openPdf = (id: string) => window.open(fileUrl(id), '_blank')

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
      }).catch((e) => e)

      // 服务端 IPP 失败 → 返回 fallbackPdfFileId，走浏览器打印
      if (r?.code === 500 && r.fallbackPdfFileId) {
        toast({
          title: 'IPP 打印失败，已切换浏览器打印',
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
        // 兜底打开 PDF
        openPdf(fid)
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
          打印下发（IPP）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="grid gap-2">
          <Button
            onClick={() => doPrint('mark')}
            disabled={busy !== null}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {busy === 'mark' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
            打印批注 PDF
          </Button>
          <Button
            onClick={() => doPrint('marks')}
            disabled={busy !== null}
            variant="secondary"
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {busy === 'marks' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
            打印纯标记层（仅√×，无题目无图）
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => doPrint('answer')} disabled={busy !== null} variant="outline">
              {busy === 'answer' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileQuestion className="mr-1 h-4 w-4" />}
              答案 PDF
            </Button>
            <Button onClick={() => doPrint('parse')} disabled={busy !== null} variant="outline">
              {busy === 'parse' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <BookOpen className="mr-1 h-4 w-4" />}
              解析 PDF
            </Button>
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            浏览器预览（兜底打印）
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
    </Card>
  )
}
