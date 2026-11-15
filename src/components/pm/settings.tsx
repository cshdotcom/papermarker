'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Wifi,
  Save,
  CheckCircle2,
  XCircle,
  Printer,
  Info,
  ScanLine,
  LinkIcon,
  KeyRound,
  Plus,
  Copy,
  Trash2,
  Power,
  Smartphone,
  ShieldCheck,
  UserRound,
  Layers,
} from 'lucide-react'
import {
  api,
  type PrinterConfig,
  type ScannerConfig,
  type ApiKeyInfo,
  type MarkLayers,
  setStoredToken,
} from '@/lib/pm'
import { clientProbeIpp, clientProbeBrother, clientProbeScanner } from '@/lib/client/net-probe'
import { usePm } from '@/lib/pm-store'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

/** 标记层默认设置项（与打印面板一致） */
const LAYER_ITEMS: { key: keyof MarkLayers; label: string }[] = [
  { key: 'marks', label: '判分标记（√ × 半勾）' },
  { key: 'scores', label: '每题得分' },
  { key: 'answers', label: '答案回填' },
  { key: 'reason', label: '错因（错在哪步）' },
  { key: 'solution', label: '完整解析' },
  { key: 'boxes', label: '题框' },
  { key: 'banner', label: '顶部分数条' },
]

export function Settings() {
  const [cfg, setCfg] = useState<PrinterConfig | null>(null)
  const [scfg, setScfg] = useState<ScannerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<{ ok: boolean; msg: string; detail?: string } | null>(null)
  const [sSaving, setSSaving] = useState(false)
  const [sProbing, setSProbing] = useState(false)
  const [sProbeResult, setSProbeResult] = useState<{
    ok: boolean
    msg: string
    detail?: string
  } | null>(null)

  // 标记层默认（用户级，保存后影响新任务与重新生成）
  const { layers, setLayers } = usePm()
  const [layerDefaults, setLayerDefaults] = useState<MarkLayers>(layers)
  const [savingLayers, setSavingLayers] = useState(false)

  const saveLayerDefaults = async () => {
    setSavingLayers(true)
    try {
      await api.saveLayerConfig(layerDefaults)
      setLayers(layerDefaults)
      toast({ title: '已保存标记层默认设置', description: '新任务与重新生成的 PDF 将按此生效' })
    } catch (e: any) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' })
    } finally {
      setSavingLayers(false)
    }
  }

  // API Key 应用连接
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null)
  const [origin, setOrigin] = useState('')

  const { toast } = useToast()

  // 账号安全（修改密码 / 修改用户名）
  const username = usePm((s) => s.username)
  const setUsernameGlobal = usePm((s) => s.setUsername)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [changingPw, setChangingPw] = useState(false)
  const [newName, setNewName] = useState('')
  const [namePw, setNamePw] = useState('')
  const [changingName, setChangingName] = useState(false)

  const changeUsername = async () => {
    const name = newName.trim()
    if (!name || !namePw) {
      toast({ title: '请填写新用户名和密码', variant: 'destructive' })
      return
    }
    setChangingName(true)
    try {
      const r = await api.changeUsername(name, namePw)
      toast({ title: r.msg || '用户名已修改' })
      // 静默替换本地 token
      if (r.token) setStoredToken(r.token, !!localStorage.getItem('pm_token'))
      setUsernameGlobal(r.username || name)
      try {
        localStorage.setItem('pm_username', r.username || name)
      } catch {}
      setNewName('')
      setNamePw('')
    } catch (e: any) {
      toast({ title: '修改失败', description: e.message, variant: 'destructive' })
    } finally {
      setChangingName(false)
    }
  }

  const changePassword = async () => {
    if (!oldPw || !newPw || !newPw2) {
      toast({ title: '请完整填写三项密码', variant: 'destructive' })
      return
    }
    if (newPw !== newPw2) {
      toast({ title: '两次输入的新密码不一致', variant: 'destructive' })
      return
    }
    if (newPw.length < 6) {
      toast({ title: '新密码至少 6 位', variant: 'destructive' })
      return
    }
    setChangingPw(true)
    try {
      const r = await api.changePassword(oldPw, newPw)
      toast({ title: '密码修改成功', description: r.msg || '下次登录请使用新密码' })
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    } catch (e: any) {
      toast({ title: '修改失败', description: e.message, variant: 'destructive' })
    } finally {
      setChangingPw(false)
    }
  }

  const fetchCfg = async () => {
    setLoading(true)
    setLoadError(null)
    // 并行加载（各自 15s 超时，单个失败不阻塞其它）
    const [p, s, k] = await Promise.allSettled([
      api.getPrinter(),
      api.getScanner(),
      api.listApiKeys(),
    ])
    if (p.status === 'fulfilled') setCfg(p.value.config)
    if (s.status === 'fulfilled') setScfg(s.value.config)
    if (k.status === 'fulfilled') setKeys(k.value.tokens)
    if (p.status === 'rejected') {
      setLoadError(p.reason?.message || '加载失败')
    } else {
      // 打印机配置是主依赖；扫描仪/密钥失败只提示
      if (s.status === 'rejected' || k.status === 'rejected') {
        const firstErr = s.status === 'rejected' ? s.reason?.message : k.reason?.message
        toast({ title: '部分配置加载失败', description: String(firstErr || ''), variant: 'destructive' })
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchCfg()
    setOrigin(window.location.origin)
  }, [])

  // 打印机探测：浏览器直接发起（服务器在云端，无法访问局域网 192.168.x.x）
  const probe = async () => {
    if (!cfg) return
    setProbing(true)
    setProbeResult(null)
    try {
      const r =
        cfg.mode === 'brother'
          ? await clientProbeBrother(cfg.host)
          : await clientProbeIpp(cfg.ippUrl)
      setProbeResult({ ok: r.ok, msg: r.msg, detail: r.detail })
      toast({
        title: r.ok ? '打印机连通正常' : '连接失败',
        description: r.detail ? `${r.msg}（${r.elapsed}ms）` : r.msg,
        variant: r.ok ? 'default' : 'destructive',
      })
    } catch (e: any) {
      setProbeResult({ ok: false, msg: e.message })
    } finally {
      setProbing(false)
    }
  }

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try {
      await api.savePrinter(cfg)
      toast({ title: '已保存打印机配置' })
    } catch (e: any) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ---------- API Key 操作 ----------
  const createKey = async () => {
    if (!newKeyName.trim()) {
      toast({ title: '请填写应用名称', variant: 'destructive' })
      return
    }
    setCreatingKey(true)
    try {
      const r = await api.createApiKey(newKeyName.trim())
      setCreatedKey({ name: r.token.name, key: r.token.key })
      setNewKeyName('')
      const k = await api.listApiKeys()
      setKeys(k.tokens)
      toast({ title: r.msg })
    } catch (e: any) {
      toast({ title: '创建失败', description: e.message, variant: 'destructive' })
    } finally {
      setCreatingKey(false)
    }
  }

  const patchKey = async (id: string, action: 'revoke' | 'disable' | 'enable') => {
    try {
      const r = await api.patchApiKey(id, action)
      toast({ title: (r as any).msg || '操作成功' })
      const k = await api.listApiKeys()
      setKeys(k.tokens)
    } catch (e: any) {
      toast({ title: '操作失败', description: e.message, variant: 'destructive' })
    }
  }

  const copyText = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: tip })
    } catch {
      toast({ title: '复制失败，请手动复制', variant: 'destructive' })
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
    )
  }

  // 加载失败：给出明确错误与重试（绝不无限转圈）
  if (!cfg && loadError) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 py-20">
        <XCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm font-medium">设置加载失败</p>
        <p className="max-w-md text-center text-xs text-muted-foreground">{loadError}</p>
        <Button size="sm" onClick={fetchCfg} className="bg-emerald-600 hover:bg-emerald-700">
          重试
        </Button>
      </div>
    )
  }

  if (!cfg) return null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* ============ 打印机配置（置顶显眼） ============ */}
      <Card className="overflow-hidden border-emerald-200 shadow-sm">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500" aria-hidden />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="h-4 w-4 text-emerald-600" />
            网络打印机配置
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">置顶</span>
          </CardTitle>
          <CardDescription>
            通用 IPP（佳能/惠普/兄弟海外版，端口 631）或 Brother 直连（国行 DCP-T428W 等，端口 9100）；打印失败时可随时改用「浏览器直接打印」
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 模式选择 */}
          <div className="space-y-1.5">
            <Label>连接模式</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCfg({ ...cfg, mode: 'ipp' })}
                className={`rounded-lg border p-3 text-left transition ${
                  cfg.mode !== 'brother'
                    ? 'border-emerald-600 bg-emerald-50/60'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Printer className="h-3.5 w-3.5" />
                  IPP 通用
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  佳能 / 惠普 / 兄弟等，端口 631
                </p>
              </button>
              <button
                onClick={() => setCfg({ ...cfg, mode: 'brother' })}
                className={`rounded-lg border p-3 text-left transition ${
                  cfg.mode === 'brother'
                    ? 'border-emerald-600 bg-emerald-50/60'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Printer className="h-3.5 w-3.5" />
                  Brother 直连
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  DCP-T428W 国行等，端口 9100
                </p>
              </button>
            </div>
          </div>

          {cfg.mode === 'brother' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bhost">Brother 打印机 IP</Label>
                <div className="flex gap-2">
                  <Input
                    id="bhost"
                    value={cfg.host}
                    onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                  {scfg && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      title="与扫描仪共用同一台一体机"
                      onClick={() => {
                        const host = scfg.host || new URL(scfg.esclUrl).hostname
                        setCfg({ ...cfg, host })
                        toast({ title: `已填入 ${host}` })
                      }}
                    >
                      <LinkIcon className="mr-1 h-3.5 w-3.5" />
                      同扫描仪
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  批注/标记层会自动渲染为 JPEG 经 9100 端口直连下发；文字版 PDF（答案/解析）将降级浏览器打印
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">打印机名称</Label>
                <Input
                  id="name"
                  value={cfg.name}
                  onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
                  placeholder="例：Canon G3810"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ippUrl">IPP 地址</Label>
                <Input
                  id="ippUrl"
                  value={cfg.ippUrl}
                  onChange={(e) => setCfg({ ...cfg, ippUrl: e.target.value })}
                  placeholder="http://192.168.1.100:631/ipp/print"
                />
                <p className="text-[11px] text-muted-foreground">
                  格式：<code className="rounded bg-muted px-1">http://打印机IP:631/ipp/print</code>
                </p>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">双面打印</Label>
                <p className="text-[11px] text-muted-foreground">默认打印模式</p>
              </div>
              <Switch checked={cfg.duplex} onCheckedChange={(v) => setCfg({ ...cfg, duplex: v })} />
            </div>
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <Label className="text-sm whitespace-nowrap">份数</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={cfg.copies}
                onChange={(e) => setCfg({ ...cfg, copies: Math.max(1, Number(e.target.value) || 1) })}
                className="h-8"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={probe} disabled={probing} variant="outline" className="flex-1">
              {probing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
              {cfg.mode === 'brother' ? '测试 9100 端口' : '测试 IPP 连接'}
            </Button>
            <Button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存配置
            </Button>
          </div>

          {probeResult && (
            <Alert variant={probeResult.ok ? 'default' : 'destructive'}>
              {probeResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <AlertTitle>{probeResult.ok ? '连接成功' : '连接失败'}</AlertTitle>
              <AlertDescription className="space-y-1">
                  <p>{probeResult.msg}</p>
                  {probeResult.detail && (
                    <p className="text-[11px] text-muted-foreground">{probeResult.detail}</p>
                  )}
                </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
        {/* 骨架屏（与卡片同构，不闪屏） */}
      {/* ============ 账号安全（修改密码） ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            账号安全
          </CardTitle>
          <CardDescription>
            当前账号 <code className="rounded bg-muted px-1 font-semibold">{username || 'teacher'}</code>
            ，修改密码后下次登录生效
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="oldPw" className="text-xs">
                旧密码
              </Label>
              <Input
                id="oldPw"
                type="password"
                autoComplete="current-password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                disabled={changingPw}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPw" className="text-xs">
                新密码（≥6位）
              </Label>
              <Input
                id="newPw"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                disabled={changingPw}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPw2" className="text-xs">
                确认新密码
              </Label>
              <Input
                id="newPw2"
                type="password"
                autoComplete="new-password"
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                disabled={changingPw}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') changePassword()
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <UserRound className="h-3 w-3" />
              网站已关闭自动登录，每次访问需输入账号密码（勾选「记住我」可 7 天免登录）
            </p>
            <Button
              size="sm"
              onClick={changePassword}
              disabled={changingPw || !oldPw || !newPw || !newPw2}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
            >
              {changingPw ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1 h-3.5 w-3.5" />}
              修改密码
            </Button>
          </div>

          <div className="border-t pt-3">
            <div className="mb-2 text-xs font-medium">修改用户名</div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder={`新用户名（当前：${username || 'teacher'}）`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={changingName}
                className="h-8 text-xs"
              />
              <Input
                type="password"
                placeholder="登录密码（验证身份）"
                value={namePw}
                onChange={(e) => setNamePw(e.target.value)}
                disabled={changingName}
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                onClick={changeUsername}
                disabled={changingName || !newName.trim() || !namePw}
                className="shrink-0"
                variant="outline"
              >
                {changingName ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserRound className="mr-1 h-3.5 w-3.5" />}
                改用户名
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============ 标记层默认（用户级，错因/答案默认开） ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-emerald-600" />
            批注标记层默认
          </CardTitle>
          <CardDescription>
            控制批注/标记层 PDF 与直连打印里包含哪些内容；错因、答案默认开启，可随时调整
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {LAYER_ITEMS.map((it) => (
              <label
                key={it.key}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition hover:bg-muted/50"
              >
                <span>{it.label}</span>
                <Switch
                  checked={layerDefaults[it.key]}
                  onCheckedChange={(v) => setLayerDefaults({ ...layerDefaults, [it.key]: v })}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              复核页与打印面板的图层开关即时生效；这里保存的是默认值（新任务/重新生成用）
            </p>
            <Button
              size="sm"
              onClick={saveLayerDefaults}
              disabled={savingLayers}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
            >
              {savingLayers ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              保存默认
            </Button>
          </div>
        </CardContent>
      </Card>


      {/* ============ 扫描仪配置 ============ */}
      {scfg && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-4 w-4 text-emerald-600" />
              网络扫描仪配置
            </CardTitle>
            <CardDescription>
              通用 eSCL/AirScan（端口 8095）或 Brother 私有协议（TCP 54921，国行 DCP-T428W 实测打通）
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 协议选择 */}
            <div className="space-y-1.5">
              <Label>扫描协议</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setScfg({ ...scfg, protocol: 'escl' })}
                  className={`rounded-lg border p-3 text-left transition ${
                    scfg.protocol !== 'brother'
                      ? 'border-emerald-600 bg-emerald-50/60'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <ScanLine className="h-3.5 w-3.5" />
                    eSCL 通用
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    AirScan / Mopria，HTTP 8095
                  </p>
                </button>
                <button
                  onClick={() => setScfg({ ...scfg, protocol: 'brother' })}
                  className={`rounded-lg border p-3 text-left transition ${
                    scfg.protocol === 'brother'
                      ? 'border-emerald-600 bg-emerald-50/60'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <ScanLine className="h-3.5 w-3.5" />
                    Brother 私有协议
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    DCP-T428W 真机已打通，TCP 54921
                  </p>
                </button>
              </div>
            </div>

            {scfg.protocol === 'brother' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="bshost">Brother 打印机 IP</Label>
                  <div className="flex gap-2">
                    <Input
                      id="bshost"
                      value={scfg.host}
                      onChange={(e) => setScfg({ ...scfg, host: e.target.value })}
                      placeholder="192.168.1.100"
                    />
                    {cfg && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        title="与打印机共用同一台一体机"
                        onClick={() => {
                          const host =
                            cfg.mode === 'brother'
                              ? cfg.host
                              : (() => {
                                  try {
                                    return new URL(cfg.ippUrl).hostname
                                  } catch {
                                    return ''
                                  }
                                })()
                          if (!host) {
                            toast({ title: '无法从打印机配置推导 IP', variant: 'destructive' })
                            return
                          }
                          setScfg({ ...scfg, host })
                          toast({ title: `已填入 ${host}` })
                        }}
                      >
                        <LinkIcon className="mr-1 h-3.5 w-3.5" />
                        同打印机
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    协议来源：iPrint&Scan SDK 字节码逆向（ESC X 直扫），扫描前请关闭手机上的
                    iPrint&amp;Scan APP（会话独占）
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">进纸源</Label>
                    <select
                      value={scfg.source}
                      onChange={(e) => setScfg({ ...scfg, source: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="Platen">平板</option>
                      <option value="Feeder">送稿器</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">色彩</Label>
                    <select
                      value={scfg.colorMode}
                      onChange={(e) => setScfg({ ...scfg, colorMode: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="Grayscale8">灰度（CGRAY）</option>
                      <option value="RGB24">彩色（C256）</option>
                      <option value="BlackAndWhite1">黑白（TEXT）</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">分辨率</Label>
                    <select
                      value={String(scfg.dpi)}
                      onChange={(e) => setScfg({ ...scfg, dpi: Number(e.target.value) })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="100">100 dpi</option>
                      <option value="200">200 dpi</option>
                      <option value="300">300 dpi</option>
                      <option value="600">600 dpi</option>
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="sname">扫描仪名称</Label>
                  <Input
                    id="sname"
                    value={scfg.name}
                    onChange={(e) => setScfg({ ...scfg, name: e.target.value })}
                    placeholder="例：Canon G3810 扫描"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="esclUrl">eSCL 地址</Label>
                  <div className="flex gap-2">
                    <Input
                      id="esclUrl"
                      value={scfg.esclUrl}
                      onChange={(e) => setScfg({ ...scfg, esclUrl: e.target.value })}
                      placeholder="http://192.168.1.100:8095/eSCL"
                    />
                    {cfg && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        title="使用打印机同 IP 推导（一体机打印/扫描同 IP）"
                        onClick={() => {
                          try {
                            const host =
                              cfg.mode === 'brother' ? cfg.host : new URL(cfg.ippUrl).hostname
                            setScfg({ ...scfg, esclUrl: `http://${host}:8095/eSCL` })
                            toast({ title: `已推导为 http://${host}:8095/eSCL` })
                          } catch {
                            toast({ title: '打印机 IPP 地址无效，无法推导', variant: 'destructive' })
                          }
                        }}
                      >
                        <LinkIcon className="mr-1 h-3.5 w-3.5" />
                        同打印机IP
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    格式：<code className="rounded bg-muted px-1">http://打印机IP:8095/eSCL</code>
                    （一体机的打印和扫描通常同 IP）
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">进纸源</Label>
                    <select
                      value={scfg.source}
                      onChange={(e) => setScfg({ ...scfg, source: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="Platen">平板</option>
                      <option value="Feeder">送稿器</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">色彩</Label>
                    <select
                      value={scfg.colorMode}
                      onChange={(e) => setScfg({ ...scfg, colorMode: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="RGB24">彩色</option>
                      <option value="Grayscale8">灰度</option>
                      <option value="BlackAndWhite1">黑白</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">分辨率</Label>
                    <select
                      value={String(scfg.dpi)}
                      onChange={(e) => setScfg({ ...scfg, dpi: Number(e.target.value) })}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="150">150 dpi</option>
                      <option value="200">200 dpi</option>
                      <option value="300">300 dpi</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  setSProbing(true)
                  setSProbeResult(null)
                  try {
                    const r = await clientProbeScanner({
                      esclUrl: scfg.esclUrl,
                      protocol: scfg.protocol,
                      host: scfg.host,
                    })
                    setSProbeResult({ ok: r.ok, msg: r.msg, detail: r.detail })
                    toast({
                      title: r.ok ? '扫描仪连通正常' : '连接失败',
                      description: r.detail ? `${r.msg}（${r.elapsed}ms）` : r.msg,
                      variant: r.ok ? 'default' : 'destructive',
                    })
                  } catch (e: any) {
                    setSProbeResult({ ok: false, msg: e.message })
                  } finally {
                    setSProbing(false)
                  }
                }}
                disabled={sProbing}
                variant="outline"
                className="flex-1"
              >
                {sProbing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                {scfg.protocol === 'brother' ? '测试 54921 握手' : '测试 eSCL 连接'}
              </Button>
              <Button
                onClick={async () => {
                  setSSaving(true)
                  try {
                    await api.saveScanner(scfg)
                    toast({ title: '已保存扫描仪配置' })
                  } catch (e: any) {
                    toast({ title: '保存失败', description: e.message, variant: 'destructive' })
                  } finally {
                    setSSaving(false)
                  }
                }}
                disabled={sSaving}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                {sSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                保存配置
              </Button>
            </div>

            {sProbeResult && (
              <Alert variant={sProbeResult.ok ? 'default' : 'destructive'}>
                {sProbeResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                <AlertTitle>{sProbeResult.ok ? '连接成功' : '连接失败'}</AlertTitle>
                <AlertDescription className="space-y-1">
                  <p>{sProbeResult.msg}</p>
                  {sProbeResult.detail && (
                    <p className="text-[11px] text-muted-foreground">{sProbeResult.detail}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* ============ API Key 应用连接 ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-emerald-600" />
            应用连接（API Key）
          </CardTitle>
          <CardDescription>
            为 Android APP / 第三方应用创建访问凭据，凭据以
            <code className="mx-1 rounded bg-muted px-1">X-API-Key</code>
            请求头调用本站全部 API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 新建 */}
          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="应用名称，例：我的安卓手机"
              maxLength={30}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createKey()
              }}
            />
            <Button
              onClick={createKey}
              disabled={creatingKey}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
            >
              {creatingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              创建
            </Button>
          </div>

          {/* 创建成功弹出的完整 Key */}
          {createdKey && (
            <Alert className="border-emerald-600/40 bg-emerald-50/50">
              <KeyRound className="h-4 w-4 text-emerald-700" />
              <AlertTitle className="text-emerald-800">
                「{createdKey.name}」创建成功
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p className="text-xs text-emerald-800/80">
                  完整 Key 仅显示这一次，请立即复制保存到 APP：
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-white px-2 py-1.5 text-xs shadow-sm">
                    {createdKey.key}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copyText(createdKey.key, '已复制 Key')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setCreatedKey(null)}>
                    我已保存，关闭
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Key 列表 */}
          {keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-8 text-muted-foreground">
              <Smartphone className="h-6 w-6 opacity-40" />
              <p className="text-sm">还没有应用连接</p>
              <p className="text-xs">创建一个 Key，在手机 APP 登录页填入即可连接本站</p>
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{k.name}</span>
                      {k.enabled ? (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                          启用
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">
                          已停用
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {k.keyMasked}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      创建于 {new Date(k.createdAt).toLocaleString('zh-CN')}
                      {k.lastUsedAt
                        ? ` · 最近使用 ${new Date(k.lastUsedAt).toLocaleString('zh-CN')}`
                        : ' · 未使用过'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={k.enabled ? '停用' : '启用'}
                    onClick={() => patchKey(k.id, k.enabled ? 'disable' : 'enable')}
                  >
                    <Power className={`h-3.5 w-3.5 ${k.enabled ? 'text-muted-foreground' : 'text-emerald-600'}`} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="吊销（永久删除）"
                    onClick={() => patchKey(k.id, 'revoke')}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* 接入说明 */}
          <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">APP 接入方法</p>
            <p>
              1. 服务器地址填 <code className="rounded bg-background px-1">{origin}</code>
            </p>
            <p>
              2. 请求头携带{' '}
              <code className="rounded bg-background px-1">X-API-Key: 你的Key</code>
              （或查询参数 <code className="rounded bg-background px-1">?apiKey=</code>）
            </p>
            <p>3. 即可调用任务列表 / 上传扫描 / 复核批注 / 下发打印等全部接口</p>
          </div>
        </CardContent>
      </Card>

      {/* ============ 说明 ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="h-4 w-4 text-muted-foreground" />
            打印 / 扫描配置说明
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p><strong>1. 同一局域网：</strong>本服务与打印/扫描一体机需在同一 WiFi / 路由器下。</p>
          <p><strong>2. IPP 模式：</strong>适用于佳能 / 惠普 / 兄弟海外版等支持 IPP 的机型，地址一般为 <code className="rounded bg-muted px-1">http://IP:631/ipp/print</code>。</p>
          <p><strong>3. Brother 直连模式：</strong>国行 DCP-T428W 等无私有驱动协议的机型。打印走 9100 端口（JPEG 直发），扫描走 54921 私有协议（原厂 SDK 逆向，真机已验证）。</p>
          <p><strong>4. 扫描独占：</strong>Brother 扫描会话独占，扫描前请退出手机 iPrint&amp;Scan APP，否则握手会拿到 -NG。</p>
          <p><strong>5. 兜底方案：</strong>直连/IPP 失败时自动返回 PDF，前端调用浏览器原生打印。</p>
        </CardContent>
      </Card>
    </div>
  )
}
