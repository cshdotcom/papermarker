'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  Settings as SettingsIcon,
  Sparkles,
  Search,
  ArrowUpDown,
  Filter,
  RotateCw,
} from 'lucide-react'
import { api, type TaskSummary } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
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

type SortKey = 'newest' | 'oldest' | 'score_desc' | 'score_asc'
type FilterKey = 'all' | 'pending' | 'reviewed' | 'printed'

const SORT_LABELS: Record<SortKey, string> = {
  newest: '最新优先',
  oldest: '最早优先',
  score_desc: '得分高→低',
  score_asc: '得分低→高',
}

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待复核' },
  { key: 'reviewed', label: '已复核' },
  { key: 'printed', label: '已打印' },
]

export function Dashboard({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<TaskSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const setView = usePm((s) => s.setView)
  const username = usePm((s) => s.username)
  const pushPendingScanFiles = usePm((s) => s.pushPendingScanFiles)

  // 搜索 / 筛选 / 排序
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('newest')

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

  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (arr.length === 0) return
    pushPendingScanFiles(arr)
    setView('scan')
    toast({
      title: `已添加 ${arr.length} 张照片`,
      description: '先调整四角与增强滤镜，确认后自动进入扫描托盘',
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  const doDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteTask(deleting.id)
      setTasks((ts) => ts.filter((t) => t.id !== deleting.id))
      toast({ title: '已删除任务', description: deleting.paperName })
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

  // 搜索 + 筛选 + 排序
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tasks.filter((t) => {
      if (q) {
        const hay = `${t.paperName} ${t.studentName || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filter === 'pending')
        return t.reviewStatus === 'pending_review' || t.reviewStatus === 'pending_ai'
      if (filter === 'reviewed') return t.reviewStatus === 'reviewed_ok'
      if (filter === 'printed') return t.printStatus === 'print_finish'
      return true
    })
    list = [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      if (sort === 'newest') return tb - ta
      if (sort === 'oldest') return ta - tb
      const ra = a.totalFull ? a.totalGet / a.totalFull : 0
      const rb = b.totalFull ? b.totalGet / b.totalFull : 0
      if (sort === 'score_desc') return rb - ra
      return ra - rb
    })
    return list
  }, [tasks, query, filter, sort])

  return (
    <div className="space-y-4">
      {/* ===== Hero 横幅 ===== */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white shadow-lg">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] bg-cover bg-center opacity-90 sm:block"
          style={{ backgroundImage: 'url(/hero-illustration.png)' }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10" aria-hidden />
        <div className="pointer-events-none absolute -bottom-10 right-1/3 h-32 w-32 rounded-full bg-white/10" aria-hidden />
        <div className="relative p-5 sm:max-w-[62%] sm:p-7">
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
            <Sparkles className="h-3 w-3" />
            AI 智能批改 · 30 秒出分
          </div>
          <h1 className="text-xl font-bold leading-snug sm:text-2xl">
            {username ? `${username}，欢迎回来` : '老师好'}
          </h1>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-emerald-50/90">
            拍照或扫描试卷，AI 自动判分并在每个空旁批注勾叉、回填答案与错因，一键打印带批注的试卷。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-md transition hover:bg-emerald-50 active:scale-95"
            >
              <Camera className="h-4 w-4" />
              拍照批改
            </button>
            <button
              onClick={() => setView('scan')}
              className="flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-white/30 active:scale-95"
            >
              <ScanLine className="h-4 w-4" />
              扫描 / 托盘
            </button>
            <button
              onClick={() => setView('settings')}
              className="flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-white/30 active:scale-95"
              title="打印机 / 扫描仪 / 标记层 配置"
            >
              <SettingsIcon className="h-4 w-4" />
              设备配置
            </button>
          </div>
        </div>
      </div>

      {/* ===== 统计卡片 ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="批改任务" value={String(tasks.length)} icon={PenLine} cls="bg-emerald-50 text-emerald-600" />
        <StatCard label="待复核" value={String(pendingCount)} icon={Clock} cls="bg-amber-50 text-amber-600" />
        <StatCard label="平均得分率" value={`${avgRate}%`} icon={TrendingUp} cls="bg-teal-50 text-teal-600" />
        <StatCard label="已打印" value={String(printedCount)} icon={Printer} cls="bg-slate-100 text-slate-600" />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />

      {/* ===== 快捷入口 ===== */}
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickCard
          onClick={() => inputRef.current?.click()}
          icon={<Camera className="h-5 w-5 text-white" />}
          iconCls="bg-emerald-600"
          title="拍照 / 相册上传"
          desc="手机直接调起相机，可多选批量，自动四角裁剪"
        />
        <QuickCard
          onClick={() => setView('scan')}
          icon={<ScanLine className="h-5 w-5 text-white" />}
          iconCls="bg-slate-800"
          title="网络扫描仪 / 复印"
          desc="eSCL 通用 · Brother 54921 私有协议 · 托盘整理 · 快速复印"
        />
        <QuickCard
          onClick={() => setView('settings')}
          icon={<Printer className="h-5 w-5 text-white" />}
          iconCls="bg-amber-600"
          title="打印机配置"
          desc="IPP 通用 / Brother 9100 直连 · 测试连通 · 标记层默认值"
          highlight
        />
      </div>

      {/* ===== 任务列表（带搜索 / 筛选 / 排序） ===== */}
      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4 text-emerald-600" />
              批改任务
            </CardTitle>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              <span className="ml-1">刷新</span>
            </Button>
          </div>

          {/* 搜索框 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索试卷名称或学生姓名…"
              className="h-9 pl-9"
            />
          </div>

          {/* 筛选 + 排序行 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 overflow-x-auto">
              <Filter className="mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {FILTER_CHIPS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    filter === c.key
                      ? 'bg-emerald-600 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 rounded-md border border-input bg-background pl-8 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[60vh] px-6 pb-6">
            {filtered.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileImage className="h-10 w-10 opacity-40" />
                <p className="text-sm">{tasks.length === 0 ? '暂无批改任务' : '没有符合条件的任务'}</p>
                <p className="text-xs">{tasks.length === 0 ? '拍一张试卷照片即可开始' : '试试调整搜索或筛选条件'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((t) => {
                  const st = STATUS_MAP[t.reviewStatus] || STATUS_MAP.pending_review
                  const pt = PRINT_MAP[t.printStatus] || PRINT_MAP.idle
                  const SIcon = st.icon
                  return (
                    <div
                      key={t.id}
                      className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition hover:border-emerald-400 hover:bg-emerald-50/40 hover:shadow-sm"
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

      {/* ===== Android APP 下载 ===== */}
      <a
        href="/papermarker.apk"
        download="PaperMarker.apk"
        className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 transition hover:border-emerald-400 hover:bg-emerald-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-emerald-900">Android 客户端（v1.1 修复登录闪退）</div>
          <div className="truncate text-[11px] text-muted-foreground">
            相机多页连拍 · 透视校正 · 直连打印 · 与网页端同账号（支持 API Key 连接）
          </div>
        </div>
        <Download className="h-4 w-4 shrink-0 text-emerald-700" />
      </a>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除此任务？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.paperName}」及其所有批注、原图、PDF 将被永久删除，此操作不可撤销。
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

function StatCard({ label, value, icon: Icon, cls }: { label: string; value: string; icon: any; cls: string }) {
  return (
    <Card className="py-0 transition hover:shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold leading-none">{value}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickCard({
  onClick,
  icon,
  iconCls,
  title,
  desc,
  highlight,
}: {
  onClick: () => void
  icon: React.ReactNode
  iconCls: string
  title: string
  desc: string
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-start gap-3 rounded-xl border-2 border-dashed p-4 text-left transition active:scale-[0.98] ${
        highlight
          ? 'border-amber-300 bg-amber-50/40 hover:border-amber-500 hover:bg-amber-50'
          : 'border-emerald-300/70 bg-emerald-50/30 hover:border-emerald-500 hover:bg-emerald-50/70'
      }`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconCls}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm font-semibold">
          {title}
          {highlight && <Sparkles className="h-3.5 w-3.5 text-amber-500" />}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{desc}</div>
      </div>
    </button>
  )
}
