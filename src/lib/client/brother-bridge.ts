'use client'

/**
 * 本地桥接服务探测与调用（浏览器 → 桥接 → Brother TCP）。
 *
 * v2.0：
 *  - 桥接地址可配置（默认 http://localhost:3790；手机访问电脑桥接时可填
 *    http://192.168.x.x:3790），先读 localStorage 缓存，登录后由设置页同步。
 *  - 所有请求带超时（AbortController），避免桥接挂死时前端永久 busy。
 *  - 失败信息区分「未运行」与「被浏览器拦截（PNA/混合内容）」。
 *
 * 原理：浏览器无法发起裸 TCP，而 Brother 54921/9100 是裸 TCP 私有协议。
 * 桥接服务（Windows exe / Android APP）把 TCP 封装成 HTTP，浏览器经桥接连打印机。
 * 全程本地（局域网）通信，不经云端。
 */

const BRIDGE_URL_KEY = 'pm_bridge_url'
export const DEFAULT_BRIDGE_URL = 'http://localhost:3790'

/** 读取本地缓存的桥接地址 */
export function getBridgeUrl(): string {
  try {
    const v = localStorage.getItem(BRIDGE_URL_KEY)
    if (v && /^https?:\/\/.+/i.test(v.trim())) return v.trim().replace(/\/+$/, '')
  } catch {}
  return DEFAULT_BRIDGE_URL
}

/** 写入本地缓存的桥接地址 */
export function setBridgeUrl(url: string) {
  try {
    const clean = url.trim().replace(/\/+$/, '')
    if (!clean || !/^https?:\/\/.+/i.test(clean)) {
      localStorage.removeItem(BRIDGE_URL_KEY)
      return
    }
    localStorage.setItem(BRIDGE_URL_KEY, clean)
  } catch {}
}

export interface BridgeStatus {
  running: boolean
  url: string
  version?: string
  /** 探测失败的原因分类，便于 UI 精确提示 */
  reason?: 'not_running' | 'blocked_or_timeout'
}

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { mode: 'cors', ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** 探测本地桥接服务是否在运行（带重试，应对 PNA 权限弹窗延迟） */
export async function detectBridge(timeoutMs = 3000): Promise<BridgeStatus> {
  const base = getBridgeUrl()
  const tryFetch = async (ms: number): Promise<{ ok: boolean; blocked: boolean }> => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    try {
      const r = await fetch(`${base}/ping`, { signal: ctrl.signal, mode: 'cors' })
      if (r.ok) {
        const data = await r.json()
        return { ok: data?.ok === true, blocked: false }
      }
      return { ok: false, blocked: false }
    } catch (e: any) {
      // TypeError: Failed to fetch 通常是 PNA/CORS 拦截或服务未启动，无法细分
      return { ok: false, blocked: true }
    } finally {
      clearTimeout(t)
    }
  }
  const r1 = await tryFetch(timeoutMs)
  if (r1.ok) return { running: true, url: base, version: '2.0.0' }
  const r2 = await tryFetch(4000)
  if (r2.ok) return { running: true, url: base, version: '2.0.0' }
  return {
    running: false,
    url: base,
    reason: r1.blocked && r2.blocked ? 'blocked_or_timeout' : 'not_running',
  }
}

export interface BridgeScanPage {
  pageNo: number
  base64: string
  size: number
}

/** 通过桥接服务执行 Brother 扫描 */
export async function bridgeScan(
  host: string,
  opts: {
    dpi?: number
    colorMode?: string
    brightness?: number
    contrast?: number
    source?: string
  }
): Promise<{ ok: boolean; msg: string; pages: BridgeScanPage[]; trace?: string[] }> {
  const base = getBridgeUrl()
  try {
    // 扫描可能耗时较长（平板出图 30-90 秒）
    const r = await fetchWithTimeout(
      `${base}/scan`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, ...opts }),
      },
      180000
    )
    return await r.json()
  } catch (e: any) {
    const msg =
      e?.name === 'AbortError'
        ? '扫描超时（180 秒），请检查打印机状态后重试'
        : `桥接服务不可达：${e?.message || e}`
    return { ok: false, msg, pages: [] }
  }
}

/** 通过桥接服务执行 Brother 直连打印（PWGRASTER 协议） */
export async function bridgePrint(
  host: string,
  jpegBase64List: string[],
  jobName?: string
): Promise<{ ok: boolean; msg: string }> {
  const base = getBridgeUrl()
  try {
    // 光栅化 + 传输大 payload，给足超时
    const r = await fetchWithTimeout(
      `${base}/print`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, jpegs: jpegBase64List, jobName }),
      },
      120000
    )
    return await r.json()
  } catch (e: any) {
    const msg =
      e?.name === 'AbortError'
        ? '桥接打印超时（120 秒），请检查打印机状态'
        : `桥接打印失败：${e?.message || e}`
    return { ok: false, msg }
  }
}

/** 通过桥接服务探测扫描仪 */
export async function bridgeProbeScan(
  host: string
): Promise<{ ok: boolean; msg: string }> {
  const base = getBridgeUrl()
  try {
    const r = await fetchWithTimeout(
      `${base}/probe/scan`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      },
      10000
    )
    return await r.json()
  } catch (e: any) {
    return { ok: false, msg: `桥接探测失败：${e?.message || e}` }
  }
}

/** 通过桥接服务探测打印机 */
export async function bridgeProbePrint(
  host: string
): Promise<{ ok: boolean; msg: string }> {
  const base = getBridgeUrl()
  try {
    const r = await fetchWithTimeout(
      `${base}/probe/print`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      },
      10000
    )
    return await r.json()
  } catch (e: any) {
    return { ok: false, msg: `桥接探测失败：${e?.message || e}` }
  }
}

/** base64 → Blob */
export function base64ToBlob(base64: string, mime = 'image/jpeg'): Blob {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export { DEFAULT_BRIDGE_URL }
