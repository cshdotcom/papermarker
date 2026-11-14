'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, FileImage, Loader2, PenLine, Printer, CheckCircle2, Clock, AlertCircle, Smartphone, Download } from 'lucide-react'
import { api, type TaskSummary } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'

const STATUS_MAP: Record<string, { label: string; cls: string; icon: any }> = {
  pending_ai: { label: 'AI 批改中', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  pending_review: { label: '待复核', cls: 'bg-blue-100 text-blue-700', icon: AlertCircle },
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
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [paperName, setPaperName] = useState('')
  const [studentName, setStudentName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const setView = usePm((s) => s.setView)

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

  const onPick = (f: File | null) => {
    if (!f) return
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
    if (!paperName) setPaperName(f.name.replace(/\.[^.]+$/, ''))
  }

  const doUpload = async () => {
    if (!file) {
      toast({ title: '请先选择或拍摄试卷图片', variant: 'destructive' })
      return
    }
    setUploading(true)
    setProgress(10)
    const timer = setInterval(() => {
      setProgress((p) => (p < 85 ? p + 3 : p))
    }, 400)
    try {
      const r = await api.uploadImage(file, paperName || '未命名试卷', studentName)
      setProgress(100)
      toast({
        title: 'AI 批改完成',
        description: `共 ${r.summary?.questionCount ?? 0} 题，得分 ${r.summary?.totalGet ?? 0}/${r.summary?.totalFull ?? 0}`,
      })
      setFile(null)
      setPreviewUrl(null)
      setPaperName('')
      setStudentName('')
      await refresh()
      onOpenTask(r.taskId)
    } catch (e: any) {
      toast({ title: '上传失败', description: e.message, variant: 'destructive' })
    } finally {
      clearInterval(timer)
      setUploading(false)
      setTimeout(() => setProgress(0), 800)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      {/* 上传区 */}
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4 text-emerald-600" />
            拍照上传试卷
          </CardTitle>
          <CardDescription>手机浏览器可直接调用相机拍摄，服务端自动矫正并调用 AI 批改</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center transition hover:border-emerald-500 hover:bg-emerald-50/40"
            onClick={() => inputRef.current?.click()}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="预览" className="max-h-44 rounded object-contain" />
            ) : (
              <>
                <FileImage className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">点击拍照 / 选择图片</p>
                <p className="text-[11px] text-muted-foreground/70">支持 JPG / PNG，最大 10MB</p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] || null)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="paperName">试卷名称</Label>
            <Input
              id="paperName"
              value={paperName}
              onChange={(e) => setPaperName(e.target.value)}
              placeholder="例：数学单元测验"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="studentName">学生姓名（可选）</Label>
            <Input
              id="studentName"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="例：张三"
            />
          </div>

          {uploading && (
            <div className="space-y-1">
              <Progress value={progress} className="h-2" />
              <p className="text-center text-xs text-muted-foreground">
                正在 AI 批改，请稍候…
              </p>
            </div>
          )}

          <Button
            onClick={doUpload}
            disabled={uploading || !file}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploading ? '批改中' : '上传并 AI 批改'}
          </Button>

          <Button variant="link" size="sm" onClick={() => setView('settings')} className="w-full text-muted-foreground">
            <Printer className="mr-1 h-3.5 w-3.5" />
            前往打印机设置（IPP）
          </Button>
        </CardContent>
      </Card>

      {/* Android APP 下载 */}
      <Card className="h-fit border-emerald-200 bg-emerald-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            安卓 APP（原生扫描端）
          </CardTitle>
          <CardDescription>
            原生 Java 代码编写（非网页打包），通过 HTTP 直连本服务端
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              相机多页扫描：自动检测纸张边缘 + 透视矫正 + 黑白增强
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              一次上传整份试卷，服务端 AI 批改并生成 PDF
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              APP 内查看批注结果、直连 IPP 打印机下发打印
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              登录账号与网页一致，支持相册批量导入扫描
            </li>
          </ul>
          <a href="/papermarker.apk" download="PaperMarker.apk">
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
              <Download className="mr-2 h-4 w-4" />
              下载 APK 安装包（v1.1 · 支持 API Key 连接）
            </Button>
          </a>
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            安装时请允许「未知来源应用」。APP 登录页填入本服务地址（例：http://192.168.1.100:3000），需与手机在同一局域网。
          </p>
        </CardContent>
      </Card>

      {/* 任务列表 */}
      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center justify-between space-y-0">
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
          <ScrollArea className="h-[60vh] px-6 pb-6">
            {tasks.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileImage className="h-10 w-10 opacity-40" />
                <p className="text-sm">还没有批改任务</p>
                <p className="text-xs">上传一张试卷图片开始吧</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => {
                  const st = STATUS_MAP[t.reviewStatus] || STATUS_MAP.pending_review
                  const pt = PRINT_MAP[t.printStatus] || PRINT_MAP.idle
                  const SIcon = st.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTask(t.id)}
                      className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40"
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
                          {t.totalGet}<span className="text-muted-foreground">/{t.totalFull}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className={`gap-1 px-1.5 text-[10px] ${st.cls}`}>
                            <SIcon className="h-3 w-3" />
                            {st.label}
                          </Badge>
                        </div>
                        <Badge variant="outline" className={`px-1.5 text-[10px] ${pt.cls}`}>
                          {pt.label}
                        </Badge>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
