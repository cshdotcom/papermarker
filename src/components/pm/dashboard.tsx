'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  FileImage,
  Loader2,
  PenLine,
  CheckCircle2,
  Clock,
  AlertCircle,
  ScanLine,
  Trash2,
  TrendingUp,
  Printer,
  ChevronRight,
  Smartphone,
  Download,
} from 'lucide-react'
import { api, type TaskSummary } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const STATUS_MAP: Record<string, { label: string; cls: string; icon: any }> = {
  pending_ai: { label: 'AI 批改中', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  pending_review: { label: '待复核', cls: 'bg-sky-100 text-sky-700', icon: AlertCircle },
  reviewed_ok: { label: '已复核', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
}

const PRINT_MAP: Record<string, { label: string; cls: string }> = {
  idle: { label: '未打印', cls: 'bg-muted text-muted-foreground' },
  printing: { label: '打印中', cls: 'bg-amber-100 text-amber-700' },
  print_finish: { label: '已打印', cls: 'bg-emerald-100 text-emerald-700' },
  print_failed: { label: '打印失败', cls: 'bg-red-100 text-red-700' },
}

export function Dashboard({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<TaskSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const setView = usePm((s) => s.setView)
  const pushPendingScanFiles = usePm((s) => s.pushPendingScanFiles)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await api.listTasks()
      setTasks(r.tasks)
    } catch (e: any) {
      toast({ title: '加载失败', description: e.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  /**
   * 拍照 / 选图 → 进入统一的「四角剪辑 → 托盘 → AI 批改」管线
   * （原直传 /api/upload 已废弃，修掉「server action not found」报错）
   */
  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (arr.length === 0) return
    pushPendingScanFiles(arr)
    setView('scan')
    toast({
      title: `已加入 ${arr.length} 张照片`,
      description: '先调节边角与增强滤镜，确认后自动进入扫描托盘',
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  const doDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteTask(deleting.id)
      setTasks((ts) => ts.filter((t) => t.id !== deleting.id))
      toast({ title: '任务已删除', description: deleting.paperName })
    } catch (e: any) {
      toast({ title: '删除失败', description: e.message, variant: 'destructive' })
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  // 统计
  const pendingCount = tasks.filter(
    (t) => t.reviewStatus === 'pending_review' || t.reviewStatus === 'pending_ai'
  ).length
  const printedCount = tasks.filter((t) => t.printStatus === 'print_finish').length
  const scored = tasks.filter((t) => t.totalFull > 0)
  const avgRate =
    scored.length > 0
      ? Math.round(
          (scored.reduce((s, t) => s + t.totalGet / t.totalFull, 0) / scored.length) * 100
        )
      : 0

  const STATS = [
    { label: '批改任务', value: String(tasks.length), icon: PenLine, cls: 'text-emerald-600 bg-emerald-50' },
    { label: '待复核', value: String(pendingCount), icon: Clock, cls: 'text-amber-600 bg-amber-50' },
    { label: '平均得分率', value: `${avgRate}%`, icon: TrendingUp, cls: 'text-sky-600 bg-sky-50' },
    { label: '已打印', value: String(printedCount), icon: Printer, cls: 'text-slate-600 bg-slate-100' },
  ]

  return (
    <div className="space-y-4">
      {/* 统计行 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label} className="py-0">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${s.cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-bold leading-none">{s.value}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 快速开始 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4 text-emerald-600" />
            快速开始
          </CardTitle>
          <CardDescription>拍照上传会先进入边角剪辑（透视矫正 / 黑白增强），再进入扫描托盘提交 AI 批改</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">拍照 / 相册上传</div>
              <div className="text-[11px] text-muted-foreground">
                手机可直接调相机，多选批量，自动边缘识别
              </div>
            </div>
          </button>
          <button
            onClick={() => setView('scan')}
            className="flex items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white shadow-sm">
              <ScanLine className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">网络扫描仪 / 托盘 / 复印</div>
              <div className="text-[11px] text-muted-foreground">
                eSCL 通用 · Brother 54921 · 托盘排序 · 快速复印
              </div>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* 任务列表 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4 text-emerald-600" />
              批改任务
            </CardTitle>
            <CardDescription>点击任务进入复核 · 批注 · 打印</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '刷新'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[62vh] px-6 pb-6">
            {tasks.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileImage className="h-10 w-10 opacity-40" />
                <p className="text-sm">还没有批改任务</p>
                <p className="text-xs">拍一张试卷照片开始吧</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => {
                  const st = STATUS_MAP[t.reviewStatus] || STATUS_MAP.pending_review
                  const pt = PRINT_MAP[t.printStatus] || PRINT_MAP.idle
                  const SIcon = st.icon
                  return (
                    <div
                      key={t.id}
                      className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:border-emerald-400 hover:bg-emerald-50/40"
                    >
                      <button
                        onClick={() => onOpenTask(t.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                          <PenLine className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{t.paperName}</span>
                            {t.studentName && (
                              <span className="shrink-0 text-xs text-muted-foreground">· {t.studentName}</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{new Date(t.createdAt).toLocaleString('zh-CN')}</span>
                            <span>·</span>
                            <span>{t.annotationCount} 题</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="text-sm font-semibold text-emerald-700">
                            {t.totalGet}
                            <span className="text-muted-foreground">/{t.totalFull}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="secondary" className={`gap-1 px-1.5 text-[10px] ${st.cls}`}>
                              <SIcon className="h-3 w-3" />
                              {st.label}
                            </Badge>
                            <Badge variant="outline" className={`px-1.5 text-[10px] ${pt.cls}`}>
                              {pt.label}
                            </Badge>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      </button>
                      <button
                        onClick={() => setDeleting(t)}
                        title="删除任务"
                        aria-label="删除任务"
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Android APP 下载（精简条） */}
      <a
        href="/papermarker.apk"
        download="PaperMarker.apk"
        className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 transition hover:border-emerald-400 hover:bg-emerald-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-emerald-900">安卓 APP（原生扫描端）</div>
          <div className="truncate text-[11px] text-muted-foreground">
            相机多页扫描 · 透视矫正 · 直连打印 · 与网页同账号（API Key 连接）
          </div>
        </div>
        <Download className="h-4 w-4 shrink-0 text-emerald-700" />
      </a>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个任务？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.paperName}」及其全部批注、原图、PDF 将被删除，操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doDelete()
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
