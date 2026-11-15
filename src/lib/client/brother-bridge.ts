'use client'

/**
 * 本地桥接服务探测与调用（浏览器 → localhost:3790 → Brother TCP）。
 *
 * 原理：
 *  浏览器无法发起裸 TCP，但 Brother 54921/9100 是裸 TCP 私有协议。
 *  用户在本地电脑运行 brother-bridge 服务（bun run dev），
 *  该服务把 TCP 封装成 HTTP，浏览器通过 localhost:3790 调用。
 *
 *  全程本地通信，不经云端。
 */

const BRIDGE_URL = 'http://localhost:3790'

export interface BridgeStatus {
  running: boolean
  url: string
  version?: string
}

/** 探测本地桥接服务是否在运行（带重试，应对 PNA 权限延迟） */
export async function detectBridge(timeoutMs = 3000): Promise<BridgeStatus> {
  const tryFetch = async (ms: number): Promise<boolean> => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    try {
      const r = await fetch(`${BRIDGE_URL}/ping`, {
        signal: ctrl.signal,
        mode: 'cors',
      })
      if (r.ok) {
        const data = await r.json()
        return data?.ok === true
      }
      return false
    } catch {
      return false
    } finally {
      clearTimeout(t)
    }
  }
  // 两次探测（第二次给浏览器更多时间处理 PNA 权限弹窗）
  const ok1 = await tryFetch(timeoutMs)
  if (ok1) return { running: true, url: BRIDGE_URL, version: '1.0.0' }
  const ok2 = await tryFetch(4000)
  return { running: ok2, url: BRIDGE_URL }
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
  try {
    const r = await fetch(`${BRIDGE_URL}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, ...opts }),
    })
    return await r.json()
  } catch (e: any) {
    return { ok: false, msg: `桥接服务不可达：${e?.message || e}`, pages: [] }
  }
}

/** 通过桥接服务执行 Brother 直连打印 */
export async function bridgePrint(
  host: string,
  jpegBase64List: string[],
  jobName?: string
): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, jpegs: jpegBase64List, jobName }),
    })
    return await r.json()
  } catch (e: any) {
    return { ok: false, msg: `桥接打印失败：${e?.message || e}` }
  }
}

/** 通过桥接服务探测扫描仪 */
export async function bridgeProbeScan(
  host: string
): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/probe/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    })
    return await r.json()
  } catch (e: any) {
    return { ok: false, msg: `桥接探测失败：${e?.message || e}` }
  }
}

/** 通过桥接服务探测打印机 */
export async function bridgeProbePrint(
  host: string
): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await fetch(`${BRIDGE_URL}/probe/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    })
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

export { BRIDGE_URL }
