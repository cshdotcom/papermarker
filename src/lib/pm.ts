// PaperMarker 前端类型 + API 客户端 + Zustand 状态

// ---------- 类型 ----------
export type JudgeType = 'correct' | 'wrong' | 'partial'
export type Layout = 'inplace' | 'separate'

export interface RoiRect { x: number; y: number; w: number; h: number }

/** 一题多空：每个小空的独立判分（VLM 识别） */
export interface BlankInfo {
  roi: RoiRect
  judge: JudgeType
  getScore: number
  fullScore: number
  answerText?: string | null
}

export interface Annotation {
  id: string
  pageNo: number
  questionText: string
  roi: RoiRect
  judgeType: JudgeType
  fullScore: number
  getScore: number
  confidence: number | null
  briefReason: string | null
  fullSolution: string | null
  answerText: string | null
  layout: Layout
  reviewStatus: 'ai_only' | 'reviewed' | 'skipped'
  originJudgeType: JudgeType | null
  originGetScore: number | null
  /** 题目作答空白区（VLM 识别，可能为空） */
  answerRoi: RoiRect | null
  /** 一题多空：每个空的独立判分（可能为空） */
  blanks: BlankInfo[] | null
}

/** 标记层开关（复核界面 / 批注 PDF / 标记层 PDF / Brother JPEG 四端共用） */
export interface MarkLayers {
  /** 判分符号 √ × ⍻ */
  marks: boolean
  /** 每题得分 */
  scores: boolean
  /** 答案回填（默认开） */
  answers: boolean
  /** 错因/错在哪步（默认开） */
  reason: boolean
  /** 完整解析（默认关，可开） */
  solution: boolean
  /** 题框 */
  boxes: boolean
  /** 顶部宽分数条（练习名/姓名得分/打印日期） */
  banner: boolean
}

export const DEFAULT_MARK_LAYERS: MarkLayers = {
  marks: true,
  scores: true,
  answers: true,
  reason: true,
  solution: false,
  boxes: true,
  banner: true,
}

export function normalizeLayers(raw: any): MarkLayers {
  const l = { ...DEFAULT_MARK_LAYERS }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_MARK_LAYERS) as (keyof MarkLayers)[]) {
      if (typeof raw[k] === 'boolean') l[k] = raw[k]
    }
  }
  return l
}

export interface TaskSummary {
  id: string
  paperName: string
  studentName: string | null
  createdAt: string
  reviewStatus: string
  printStatus: string
  totalGet: number
  totalFull: number
  annotationCount: number
}

export interface TaskDetail {
  id: string
  paperName: string
  studentName: string | null
  reviewStatus: string
  printStatus: string
  printMode: string | null
  parseMode: string | null
  answerMode: string | null
  totalGet: number
  totalFull: number
  hasAnswerPage: number
  hasParsePage: number
  imgWidth: number
  imgHeight: number
  createdAt: string
  annotations: Annotation[]
  pages: { pageNo: number; pageGet: number; pageFull: number }[]
  pageFiles: { pageNo: number; fileId: string; w: number; h: number }[]
  originFileId: string | undefined
  markPdfFileId: string | undefined
  marksPdfFileId: string | undefined
  answerPdfFileId: string | undefined
  parsePdfFileId: string | undefined
}

export interface PrinterConfig {
  ippUrl: string
  name: string
  duplex: boolean
  copies: number
  mode: string // ipp（通用 IPP） | brother（Brother 9100 直连）
  host: string // Brother 直连模式打印机 IP
}

export interface ScannerConfig {
  esclUrl: string
  name: string
  source: string
  colorMode: string
  dpi: number
  protocol: string // escl（通用 eSCL） | brother（Brother 54921 私有协议）
  host: string // Brother 模式打印机 IP
}

export interface ScannerCaps {
  name: string
  platen: boolean
  adf: boolean
  duplex: boolean
  colorModes: string[]
  resolutions: number[]
  maxW: number
  maxH: number
}

export interface ApiKeyInfo {
  id: string
  name: string
  keyMasked: string
  enabled: boolean
  lastUsedAt: string | null
  createdAt: string
}

export interface TrayPage {
  id: string
  url: string
  w: number
  h: number
}

// ---------- API 客户端 ----------
const TOKEN_KEY = 'pm_token'

export function setStoredToken(token: string | null, remember = true) {
  try {
    // 两处都清，避免残留
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    if (token) {
      // 记住我 → localStorage（7天）；否则 sessionStorage（关浏览器即退出，关闭自动登录）
      ;(remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
    }
  } catch {}
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

const USERNAME_KEY = 'pm_username'

/** 登录成功后缓存用户名，下次打开免闪屏直接渲染主界面 */
export function setCachedUsername(u: string) {
  try {
    if (u) localStorage.setItem(USERNAME_KEY, u)
    else localStorage.removeItem(USERNAME_KEY)
  } catch {}
}

export function getCachedUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) || ''
  } catch {
    return ''
  }
}

/** 文件访问 URL（img / window.open 无法带 Header，改用 token 查询参数兼容 iframe/跨域预览） */
export function fileUrl(fileId: string): string {
  const t = getStoredToken()
  return `/api/file/${fileId}${t ? `?token=${t}` : ''}`
}

/** 统一带上 Bearer Token（localStorage），避免 iframe / 跨域预览环境 Cookie 被拦 */
function authHeaders(): Record<string, string> {
  const t = getStoredToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function jfetch<T = any>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...rest } = init || {}
  const ctrl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(rest?.headers || {}) },
      ...rest,
      signal: ctrl.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
  const text = await res.text()
  let json: any = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) throw new Error(json.msg || `HTTP ${res.status}`)
  return json as T
}

export const api = {
  login: async (username: string, password: string, remember = false) => {
    const r = await jfetch<{ token?: string; user?: { id: string; username: string } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, remember }),
      }
    )
    if (r?.token) {
      setStoredToken(r.token, remember)
      setCachedUsername(r?.user?.username || username.trim())
    }
    return r
  },
  changePassword: (oldPassword: string, newPassword: string) =>
    jfetch<{ code: number; msg: string }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  logout: () => {
    setStoredToken(null)
    setCachedUsername('')
    try {
      document.cookie = 'pm_token=; Path=/; Max-Age=0'
    } catch {}
  },
  me: () =>
    jfetch<{
      user: { id: string; username: string }
      config?: { layers?: Partial<MarkLayers> }
    }>('/api/auth/me'),
  saveLayerConfig: (layers: Partial<MarkLayers>) =>
    jfetch<{ code: number; layers: MarkLayers }>('/api/auth/config', {
      method: 'PUT',
      body: JSON.stringify({ layers }),
    }),
  listTasks: () => jfetch<{ tasks: TaskSummary[] }>('/api/tasks'),
  getTask: (id: string) =>
    jfetch<{ task: TaskDetail }>(`/api/tasks/${id}`, { timeoutMs: 20000 }),
  deleteTask: (id: string) => jfetch(`/api/tasks/${id}`, { method: 'DELETE', timeoutMs: 20000 }),
  updateAnnotation: (patch: any) =>
    jfetch('/api/annotation', { method: 'PATCH', body: JSON.stringify(patch) }),
  batchReview: (taskId: string, action: 'review_all' | 'reset_ai') =>
    jfetch('/api/review', { method: 'POST', body: JSON.stringify({ taskId, action }) }),
  print: (body: any) => jfetch('/api/print', { method: 'POST', body: JSON.stringify(body) }),
  probePrinter: (body: { ippUrl?: string; mode?: string; host?: string }) =>
    jfetch('/api/printer/probe', { method: 'POST', body: JSON.stringify(body) }),
  getPrinter: () => jfetch<{ config: PrinterConfig }>('/api/printer/config'),
  savePrinter: (cfg: Partial<PrinterConfig>) =>
    jfetch('/api/printer/config', { method: 'PUT', body: JSON.stringify(cfg) }),
  generatePdf: (taskId: string, layers?: Partial<MarkLayers>) =>
    jfetch('/api/pdf/generate', {
      method: 'POST',
      body: JSON.stringify({ taskId, layers }),
    }),
  // 扫描相关
  getScanner: () => jfetch<{ config: ScannerConfig }>('/api/scanner/config'),
  saveScanner: (cfg: Partial<ScannerConfig>) =>
    jfetch('/api/scanner/config', { method: 'PUT', body: JSON.stringify(cfg) }),
  probeScanner: (body: { esclUrl?: string; protocol?: string; host?: string }) =>
    jfetch<{ ok: boolean; msg: string; caps?: ScannerCaps; trace?: string[] }>('/api/scanner/probe', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  esclScan: (opts: { source?: string; colorMode?: string; dpi?: number }) =>
    jfetch<{ msg: string; pages: TrayPage[] }>('/api/scanner/scan', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  // API Key 应用连接
  listApiKeys: () => jfetch<{ tokens: ApiKeyInfo[] }>('/api/apikeys'),
  createApiKey: (name: string) =>
    jfetch<{ msg: string; token: { id: string; name: string; key: string } }>('/api/apikeys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  patchApiKey: (id: string, action: 'revoke' | 'disable' | 'enable') =>
    jfetch('/api/apikeys', { method: 'PATCH', body: JSON.stringify({ id, action }) }),
  listTrayPages: () => jfetch<{ pages: TrayPage[] }>('/api/scan/pages'),
  uploadTrayPage: (blob: Blob) => {
    const fd = new FormData()
    fd.append('image', blob, 'scan.jpg')
    return fetch('/api/scan/pages', {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: authHeaders(),
    }).then(async (r) => {
      const j = await r.json()
      if (!r.ok) throw new Error(j.msg || '上传失败')
      return j as { code: number; page: TrayPage }
    })
  },
  deleteTrayPage: (id?: string) =>
    jfetch(`/api/scan/pages${id ? `?id=${id}` : ''}`, { method: 'DELETE' }),
  createTaskFromPages: (fileIds: string[], paperName: string, studentName: string) =>
    jfetch('/api/tasks/from-pages', {
      method: 'POST',
      body: JSON.stringify({ fileIds, paperName, studentName }),
    }),
  copyPrint: (body: {
    fileIds: string[]
    duplex?: boolean
    copies?: number
    fallback?: boolean
  }) => jfetch('/api/print/copy', { method: 'POST', body: JSON.stringify(body) }),
}
