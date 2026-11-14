'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  RefreshCw,
  CheckCheck,
  Sparkles,
  Layers,
  WifiOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { api, type Annotation, type TaskDetail, type JudgeType } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { AnnotationOverlay } from './annotation-overlay'
import { PrintPanel } from './print-panel'
import { JudgeMarkIcon } from './judge-icons'

const JUDGE_INFO: Record<JudgeType, { label: string; color: string; bg: string; icon: any }> = {
  correct: { label: '正确', color: 'text-emerald-700', bg: 'bg-emerald-100 border-emerald-300', icon: Check },
  wrong: { label: '错误', color: 'text-red-700', bg: 'bg-red-100 border-red-300', icon: X },
  partial: { label: '半对', color: 'text-amber-700', bg: 'bg-amber-100 border-amber-300', icon: null },
}

export function Review({ taskId }: { taskId: string }) {
  const { setView, setTaskDetail, taskDetail, selectedAnnotationId, setSelected } = usePm()
  const [task, setTask] = useState<TaskDetail | null>(
    taskDetail && taskDetail.id === taskId ? taskDetail : null
  )
  const [loading, setLoading] = useState(!task)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [batching, setBatching] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const { toast } = useToast()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchTask = async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const r = await api.getTask(taskId)
      setTask(r.task)
      setTaskDetail(r.task)
    } catch (e: any) {
      if (!silent) setLoadError(e?.message || '加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    fetchTask()
  }, [taskId])

  useEffect(() => {
    setCurrentPage(1)
  }, [taskId])

  // 异步批改轮询：任务处于 pending_ai 时每 3 秒静默刷新，直到变为 pending_review
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (task?.reviewStatus === 'pending_ai') {
      pollRef.current = setInterval(() => fetchTask(true), 3000)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [task?.reviewStatus, taskId])

  const patchLocal = (id: string, patch: Partial<Annotation>) => {
    setTask((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        annotations: prev.annotations.map((a) =>
          a.id === id ? { ...a, ...patch, reviewStatus: 'reviewed' } : a
        ),
      }
    })
  }

  const patchRemote = async (id: string, patch: any) => {
    setSaving(true)
    try {
      const r = await api.updateAnnotation({ id, ...patch })
      setTask((prev) => (prev ? { ...prev, totalGet: r.totalGet, totalFull: r.totalFull } : prev))
    } catch (e: any) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const saveDebounced = (id: string, patch: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => patchRemote(id, patch), 500)
  }

  const setJudge = (id: string, judge: JudgeType) => {
    patchLocal(id, { judgeType: judge })
    const ann = task?.annotations.find((a) => a.id === id)
    if (ann) {
      let get = ann.getScore
      if (judge === 'correct') get = ann.fullScore
      else if (judge === 'wrong') get = 0
      else get = Math.round(ann.fullScore / 2)
      patchLocal(id, { getScore: get })
      patchRemote(id, { judgeType: judge, getScore: get })
    }
  }

  const batchReview = async (action: 'review_all' | 'reset_ai') => {
    setBatching(true)
    try {
      await api.batchReview(taskId, action)
      toast({ title: action === 'review_all' ? '已全部复核通过' : '已恢复 AI 判断' })
      await fetchTask()
    } catch (e: any) {
      toast({ title: '操作失败', description: e.message, variant: 'destructive' })
    } finally {
      setBatching(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm text-muted-foreground">加载任务详情…</p>
      </div>
    )
  }

  // 异步批改进行中：显示进度提示（轮询自动刷新）
  if (task && task.reviewStatus === 'pending_ai') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <div className="relative">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-600" />
          <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-emerald-500" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold">AI 正在批改中</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {task.paperName} · {task.imgWidth ? '图像已接收' : '处理中'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">页面已上传成功，批改在后台进行，预计 20-30 秒完成…</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => fetchTask()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 立即刷新
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setView('dashboard')}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回列表
          </Button>
        </div>
      </div>
    )
  }

  if (!task && loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <WifiOff className="h-8 w-8 text-red-500" />
        <p className="text-sm font-medium">任务详情加载失败</p>
        <p className="max-w-md text-center text-xs text-muted-foreground">{loadError}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={fetchTask} className="bg-emerald-600 hover:bg-emerald-700">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重试
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView('dashboard')}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回列表
          </Button>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
        <p>任务不存在或已删除</p>
        <Button variant="outline" size="sm" onClick={() => setView('dashboard')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回列表
        </Button>
      </div>
    )
  }

  const reviewedCount = task.annotations.filter((a) => a.reviewStatus === 'reviewed').length
  const percent = task.totalFull ? Math.round((task.totalGet / task.totalFull) * 100) : 0

  const pageFiles = task.pageFiles && task.pageFiles.length > 0 ? task.pageFiles : []
  const currentFile = pageFiles.find((p) => p.pageNo === currentPage) || pageFiles[0]
  // 关键修复：题目列表只显示当前页的题目
  const pageAnnotations = task.annotations.filter((a) => (a.pageNo || 1) === currentPage)
  const pageScore = task.pages.find((p) => p.pageNo === currentPage)

  // 当前选中题：优先匹配当前页
  const selected =
    pageAnnotations.find((a) => a.id === selectedAnnotationId) ||
    pageAnnotations[0] ||
    task.annotations.find((a) => a.id === selectedAnnotationId) ||
    null

  // 切到题目所在页（跨页点击时自动翻页）
  const selectAnnotation = (a: Annotation) => {
    if ((a.pageNo || 1) !== currentPage) setCurrentPage(a.pageNo || 1)
    setSelected(a.id)
  }

  // 翻页
  const maxPage = pageFiles.length
  const goPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
      setSelected(null)
    }
  }
  const goNextPage = () => {
    if (currentPage < maxPage) {
      setCurrentPage(currentPage + 1)
      setSelected(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部摘要栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <Button variant="outline" size="sm" onClick={() => setView('dashboard')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{task.paperName}</span>
            {task.studentName && (
              <span className="shrink-0 text-xs text-muted-foreground">· {task.studentName}</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(task.createdAt).toLocaleString('zh-CN')} · 共 {task.annotations.length} 题 · 已复核 {reviewedCount}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="rounded-lg bg-slate-900 px-3 py-1.5 text-white">
            <div className="text-[10px] opacity-70">得分</div>
            <div className="text-lg font-bold leading-none">
              {task.totalGet}
              <span className="text-xs font-normal opacity-70"> / {task.totalFull}</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className={
              percent >= 80
                ? 'border-emerald-300 text-emerald-700'
                : percent >= 60
                ? 'border-amber-300 text-amber-700'
                : 'border-red-300 text-red-700'
            }
          >
            得分率 {percent}%
          </Badge>
        </div>

        <div className="flex w-full items-center gap-1 sm:w-auto">
          <Button size="sm" variant="outline" onClick={() => batchReview('review_all')} disabled={batching}>
            <CheckCheck className="mr-1 h-3.5 w-3.5" /> 全部通过
          </Button>
          <Button size="sm" variant="ghost" onClick={() => batchReview('reset_ai')} disabled={batching}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 恢复AI
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        {/* 左：图片 + 批注叠加 */}
        <div className="space-y-3">
          {/* 页码切换（多页任务） */}
          {maxPage > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={goPrevPage} disabled={currentPage <= 1} className="h-7 px-2">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-muted-foreground">
                第 {currentPage} / {maxPage} 页
              </span>
              <Button variant="ghost" size="sm" onClick={goNextPage} disabled={currentPage >= maxPage} className="h-7 px-2">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="mx-1 text-muted-foreground/40">|</span>
              {pageFiles.map((p) => {
                const ps = task.pages.find((x) => x.pageNo === p.pageNo)
                return (
                  <button
                    key={p.pageNo}
                    onClick={() => {
                      setCurrentPage(p.pageNo)
                      setSelected(null)
                    }}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition ${
                      p.pageNo === currentPage
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-muted text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    P{p.pageNo}
                    {ps ? ` ${ps.pageGet}/${ps.pageFull}` : ''}
                  </button>
                )
              })}
            </div>
          )}
          {currentFile && (
            <AnnotationOverlay
              page={currentFile}
              annotations={pageAnnotations}
              pageScore={pageScore ? { get: pageScore.pageGet, full: pageScore.pageFull } : undefined}
            />
          )}
        </div>

        {/* 右：批注编辑 + 打印 */}
        <div className="space-y-3">
          <Tabs defaultValue="editor">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="editor">判分编辑</TabsTrigger>
              <TabsTrigger value="print">打印下发</TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="mt-3 space-y-3">
              {/* 当前页题目列表 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-emerald-600" /> 题目列表
                    </span>
                    {maxPage > 1 && (
                      <span className="text-[11px] font-normal text-muted-foreground">第 {currentPage} 页</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="max-h-64 px-3 pb-3">
                    <div className="space-y-1">
                      {pageAnnotations.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">本页暂无题目</p>
                      ) : (
                        pageAnnotations.map((a, i) => {
                          const info = JUDGE_INFO[a.judgeType]
                          const active = a.id === selected?.id
                          return (
                            <button
                              key={a.id}
                              onClick={() => selectAnnotation(a)}
                              className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-xs transition ${
                                active
                                  ? 'border-emerald-400 bg-emerald-50'
                                  : 'border-transparent hover:bg-muted'
                              }`}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                                {i + 1}
                              </span>
                              <span className="min-w-0 flex-1 break-words line-clamp-2 leading-tight">
                                {a.questionText || `第 ${i + 1} 题`}
                              </span>
                              <span className={`shrink-0 font-semibold ${info.color}`}>
                                {a.getScore}/{a.fullScore}
                              </span>
                              <Badge variant="outline" className={`shrink-0 gap-1 px-1 text-[9px] ${info.bg}`}>
                                <JudgeMarkIcon type={a.judgeType} size={10} strokeWidth={3.2} />
                                {info.label}
                              </Badge>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* 单题编辑器 */}
              {selected ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="truncate">{selected.questionText || '当前题目'}</span>
                      </span>
                      {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {selected.confidence != null && (
                        <span>AI 置信度 {Math.round(selected.confidence * 100)}%</span>
                      )}
                      <Badge variant="secondary" className="text-[9px]">
                        {selected.reviewStatus === 'ai_only'
                          ? 'AI 判定'
                          : selected.reviewStatus === 'reviewed'
                          ? '已复核'
                          : '已跳过'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* 判分类型 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">判分</Label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(Object.keys(JUDGE_INFO) as JudgeType[]).map((j) => {
                          const info = JUDGE_INFO[j]
                          return (
                            <button
                              key={j}
                              onClick={() => setJudge(selected.id, j)}
                              className={`flex items-center justify-center gap-1 rounded-md border p-2 text-xs transition ${
                                selected.judgeType === j ? info.bg : 'border-muted hover:bg-muted'
                              }`}
                            >
                              <JudgeMarkIcon type={j} size={15} className={info.color} />
                              {info.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 得分 / 满分 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">得分</Label>
                        <Input
                          type="number"
                          value={selected.getScore}
                          min={0}
                          max={selected.fullScore}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0)
                            patchLocal(selected.id, { getScore: v })
                            saveDebounced(selected.id, { getScore: v })
                          }}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">满分</Label>
                        <Input
                          type="number"
                          value={selected.fullScore}
                          min={0}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0)
                            patchLocal(selected.id, { fullScore: v })
                            saveDebounced(selected.id, { fullScore: v })
                          }}
                          className="h-8"
                        />
                      </div>
                    </div>

                    {/* 标准答案 */}
                    <div className="space-y-1">
                      <Label className="text-xs">标准答案</Label>
                      <Input
                        value={selected.answerText || ''}
                        onChange={(e) => patchLocal(selected.id, { answerText: e.target.value })}
                        onBlur={() => patchRemote(selected.id, { answerText: selected.answerText })}
                        className="h-8"
                      />
                    </div>

                    {/* 扣分原因 */}
                    <div className="space-y-1">
                      <Label className="text-xs">扣分原因 / 点评</Label>
                      <Textarea
                        value={selected.briefReason || ''}
                        onChange={(e) => patchLocal(selected.id, { briefReason: e.target.value })}
                        onBlur={() => patchRemote(selected.id, { briefReason: selected.briefReason })}
                        className="min-h-[60px] text-xs"
                      />
                    </div>

                    {/* 完整解析 */}
                    <div className="space-y-1">
                      <Label className="text-xs">完整解析</Label>
                      <Textarea
                        value={selected.fullSolution || ''}
                        onChange={(e) => patchLocal(selected.id, { fullSolution: e.target.value })}
                        onBlur={() => patchRemote(selected.id, { fullSolution: selected.fullSolution })}
                        className="min-h-[80px] text-xs"
                      />
                    </div>

                    <Separator />

                    {/* 答案排版 */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">答案排版</Label>
                      <div className="flex gap-1">
                        {(['inplace', 'separate'] as const).map((l) => (
                          <button
                            key={l}
                            onClick={() => {
                              patchLocal(selected.id, { layout: l })
                              patchRemote(selected.id, { layout: l })
                            }}
                            className={`rounded border px-2 py-1 text-xs ${
                              selected.layout === l
                                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                : 'border-muted text-muted-foreground'
                            }`}
                          >
                            {l === 'inplace' ? '原位答案' : '独立答案页'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {selected.originJudgeType &&
                      (selected.originJudgeType !== selected.judgeType ||
                        selected.originGetScore !== selected.getScore) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full text-xs"
                          onClick={() => {
                            const patch = {
                              judgeType: selected.originJudgeType,
                              getScore: selected.originGetScore ?? selected.getScore,
                            }
                            patchLocal(selected.id, patch)
                            patchRemote(selected.id, patch)
                          }}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> 恢复 AI 原始判断
                        </Button>
                      )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    选择一道题进行复核
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="print" className="mt-3">
              <PrintPanel task={task} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
