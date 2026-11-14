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
  Settings as SettingsIcon,
  Sparkles,
  Zap,
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
  pending_ai: { label: 'AI Batch Grading', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  pending_review: { label: 'Pending Review', cls: 'bg-sky-100 text-sky-700', icon: AlertCircle },
  reviewed_ok: { label: 'Reviewed', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
}

const PRINT_MAP: Record<string, { label: string; cls: string }> = {
  idle: { label: 'Not Printed', cls: 'bg-muted text-muted-foreground' },
  printing: { label: 'Printing', cls: 'bg-amber-100 text-amber-700' },
  print_finish: { label: 'Printed', cls: 'bg-emerald-100 text-emerald-700' },
  print_failed: { label: 'Print Failed', cls: 'bg-red-100 text-red-700' },
}

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

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await api.listTasks()
      setTasks(r.tasks)
    } catch (e: any) {
      toast({ title: 'Loading failed', description: e.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  /**
   * Photo / image selection → enters the unified "four-corner crop → tray → AI grading" pipeline
   */
  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (arr.length === 0) return
    pushPendingScanFiles(arr)
    setView('scan')
    toast({
      title: `Added ${arr.length} photo(s)`,
      description: 'First adjust the corners and enhancement filter, then confirm to automatically enter the scan tray',
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  const doDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteTask(deleting.id)
      setTasks((ts) => ts.filter((t) => t.id !== deleting.id))
      toast({ title: 'Task deleted', description: deleting.paperName })
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  // Statistics
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

  return (
    <div className="space-y-4">
      {/* ===== Hero Banner ===== */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white shadow-lg">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] bg-cover bg-center opacity-90 sm:block"
          style={{ backgroundImage: 'url(/hero-illustration.png)' }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10" aria-hidden />
        <div className="pointer-events-none absolute -bottom-10 right-1/3 h-32 w-32 rounded-full bg-white/10" aria-hidden />
        <div className="relative max-w-[58%] p-5 sm:p-7">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
            <Sparkles className="h-3 w-3" />
            AI Grading · Grading in 30 seconds
          </div>
          <h1 className="text-xl font-bold leading-snug sm:text-2xl">
            {username ? `${username}, Hello` : 'Hello, Teacher'}
          </h1>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-emerald-50/90">
            Take a photo of the exam paper or scan it with the scanner; AI will grade it and annotate each blank, automatically backfill answers and error causes, and print it with one click.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-md transition hover:bg-emerald-50 active:scale-95"
            >
              <Camera className="h-4 w-4" />
              Take Photo to Grade
            </button>
            <button
              onClick={() => setView('scan')}
              className="flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-white/30 active:scale-95"
            >
              <ScanLine className="h-4 w-4" />
              Scanner / Tray
            </button>
            <button
              onClick={() => setView('settings')}
              className="flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold backdrop-blur transition hover:bg-white/30 active:scale-95"
              title="Printer / Scanner / Annotation Layer Configuration"
            >
              <SettingsIcon className="h-4 w-4" />
              Device Configuration
            </button>
          </div>
        </div>
      </div>

      {/* ===== Statistics ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Grading Tasks" value={String(tasks.length)} icon={PenLine} cls="bg-emerald-50 text-emerald-600" />
        <StatCard label="Pending Review" value={String(pendingCount)} icon={Clock} cls="bg-amber-50 text-amber-600" />
        <StatCard label="Average Score Rate" value={`${avgRate}%`} icon={TrendingUp} cls="bg-teal-50 text-teal-600" />
        <StatCard label="Printed" value={String(printedCount)} icon={Printer} cls="bg-slate-100 text-slate-600" />
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

      {/* ===== Multi-function Quick Entry ===== */}
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickCard
          onClick={() => inputRef.current?.click()}
          icon={<Camera className="h-5 w-5 text-white" />}
          iconCls="bg-emerald-600"
          title="Photo / Album Upload"
          desc="Phone can directly call the camera, multi-select batch, auto corner crop"
        />
        <QuickCard
          onClick={() => setView('scan')}
          icon={<ScanLine className="h-5 w-5 text-white" />}
          iconCls="bg-slate-800"
          title="Network Scanner / Copy"
          desc="eSCL universal · Brother 54921 · Tray sorting · Quick copy"
        />
        <QuickCard
          onClick={() => setView('settings')}
          icon={<Printer className="h-5 w-5 text-white" />}
          iconCls="bg-amber-600"
          title="Printer Configuration"
          desc="IPP universal / Brother direct connection · Test connection · Annotation layer default values"
          highlight
        />
      </div>

      {/* ===== Task List ===== */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4 text-emerald-600" />
              Grading Tasks
            </CardTitle>
            <CardDescription>Click a task to enter review · annotate · print</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[62vh] px-6 pb-6">
            {tasks.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileImage className="h-10 w-10 opacity-40" />
                <p className="text-sm">No grading tasks yet</p>
                <p className="text-xs">Take a photo of an exam paper to get started</p>
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
                            <span>{t.annotationCount} questions</span>
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
                        title="Delete task"
                        aria-label="Delete task"
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

      {/* ===== Android APP Download ===== */}
      <a
        href="/papermarker.apk"
        download="PaperMarker.apk"
        className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 transition hover:border-emerald-400 hover:bg-emerald-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-emerald-900">Android APP (v1.1 Fixed Login Loop)</div>
          <div className="truncate text-[11px] text-muted-foreground">
            Camera multi-page scanning · Perspective correction · Direct printing · Same account as web (supports API Key connection)
          </div>
        </div>
        <Download className="h-4 w-4 shrink-0 text-emerald-700" />
      </a>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.paperName}" and all its annotations, original images, and PDFs will be deleted. This operation cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doDelete()
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Confirm Delete
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
          {highlight && <Zap className="h-3.5 w-3.5 text-amber-500" />}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{desc}</div>
      </div>
    </button>
  )
}
