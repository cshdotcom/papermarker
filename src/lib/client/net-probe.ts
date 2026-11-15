'use client'

/**
 * 客户端局域网设备连通性探测（浏览器直接发起，不经服务器）。
 *
 * 设计原理：
 *  - 打印机 / 扫描仪在用户局域网内，服务器（云端）无法访问 192.168.x.x
 *  - 浏览器与打印机在同一局域网，可以发 fetch 探测
 *  - 用 mode:'no-cors' 发 fetch：
 *      · 端口关闭 → TCP RST → fetch 立即 reject（很快）
 *      · 端口开放且是 HTTP 服务（如 IPP 631）→ 返回 opaque 响应 → resolve
 *      · 端口开放但非 HTTP（如 Brother 9100）→ TCP 连上但无 HTTP 响应 → 挂住到超时
 *  - 启发式：reject 极快（<500ms）= 端口关闭；resolve 或挂住到超时 = 端口开放
 */

export interface ProbeResult {
  ok: boolean
  msg: string
  /** 可达但协议不匹配时给出提示 */
  detail?: string
  /** 耗时 ms */
  elapsed: number
}

/**
 * 探测一个 URL 的连通性（浏览器侧）。
 * @param url 完整 URL，如 http://192.168.1.100:631/ipp/print
 * @param timeoutMs 超时（默认 4000ms）
 */
export async function clientProbeUrl(url: string, timeoutMs = 4000): Promise<ProbeResult> {
  const t0 = Date.now()
  let urlObj: URL
  try {
    urlObj = new URL(url)
  } catch {
    return { ok: false, msg: 'URL 格式无效', elapsed: 0 }
  }
  const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    // no-cors：即使打印机不返回 CORS 头，TCP 能连上就 resolve（opaque）
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
      // no-cors 模式下 redirect 必须为 follow，否则浏览器报 CORS 错误
      redirect: 'follow',
    })
    clearTimeout(timer)
    const elapsed = Date.now() - t0
    return {
      ok: true,
      msg: `${urlObj.hostname}:${port} 可达`,
      detail: '浏览器已成功连接到该地址',
      elapsed,
    }
  } catch (e: any) {
    clearTimeout(timer)
    const elapsed = Date.now() - t0

    // 区分「超时 abort」与「快速 reject」
    const isAbort = e?.name === 'AbortError' || elapsed > timeoutMs - 50

    if (isAbort) {
      // 超时 = TCP 可能连上了但无 HTTP 响应（非 HTTP 服务如 9100），视为端口开放
      return {
        ok: true,
        msg: `${urlObj.hostname}:${port} 端口开放（连接已建立，非 HTTP 服务或需更长握手）`,
        detail: '该端口接受 TCP 连接，但未返回 HTTP 响应。Brother 9100 等裸 TCP 服务属正常现象。',
        elapsed,
      }
    }

    // 快速 reject = DNS 解析失败 或 端口关闭（RST） 或 拒绝连接
    const errName = e?.name || ''
    const errStr = String(e?.message || e || '')
    if (errStr.includes('Failed to fetch') || errName === 'TypeError') {
      // 浏览器无法建立连接
      return {
        ok: false,
        msg: `${urlObj.hostname}:${port} 无法连接（端口关闭 / 设备未开机 / 不在同一局域网）`,
        detail: errStr,
        elapsed,
      }
    }
    return {
      ok: false,
      msg: `${urlObj.hostname}:${port} 连接失败：${errStr}`,
      elapsed,
    }
  }
}

/**
 * 探测 IPP 打印机（端口 631，HTTP 服务，能拿到 HTTP 响应）。
 */
export async function clientProbeIpp(ippUrl: string): Promise<ProbeResult> {
  if (!ippUrl) return { ok: false, msg: 'IPP 地址为空', elapsed: 0 }
  const r = await clientProbeUrl(ippUrl, 5000)
  return {
    ...r,
    msg: r.ok
      ? `IPP 服务可达（${r.elapsed}ms）`
      : `IPP 连接失败：${r.msg}`,
  }
}

/**
 * 探测 Brother 9100 直连端口（裸 TCP，无 HTTP 响应，靠超时启发式判定端口开放）。
 */
export async function clientProbeBrother(host: string): Promise<ProbeResult> {
  if (!host) return { ok: false, msg: '打印机 IP 为空', elapsed: 0 }
  const hostClean = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!hostClean) return { ok: false, msg: '打印机 IP 为空', elapsed: 0 }
  // Brother 9100：裸 TCP，浏览器 fetch 会挂住到超时 → 视为端口开放
  const url = `http://${hostClean}:9100/`
  const r = await clientProbeUrl(url, 4000)
  return {
    ...r,
    msg: r.ok
      ? `Brother 9100 端口开放（${hostClean}，${r.elapsed}ms）`
      : `Brother 9100 连接失败：${r.msg}`,
  }
}

/**
 * 探测扫描仪：
 *  - eSCL 模式：HTTP 服务（8095），能拿到响应
 *  - Brother 模式：54921 私有协议，TCP 连上即可
 */
export async function clientProbeScanner(opts: {
  protocol: string
  esclUrl?: string
  host?: string
}): Promise<ProbeResult> {
  if (opts.protocol === 'brother') {
    if (!opts.host) return { ok: false, msg: '扫描仪 IP 为空', elapsed: 0 }
    const hostClean = opts.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
    if (!hostClean) return { ok: false, msg: '扫描仪 IP 为空', elapsed: 0 }
    const url = `http://${hostClean}:54921/`
    const r = await clientProbeUrl(url, 4000)
    return {
      ...r,
      msg: r.ok
        ? `Brother 54921 端口开放（${hostClean}，${r.elapsed}ms）`
        : `Brother 54921 连接失败：${r.msg}`,
    }
  }
  // eSCL
  if (!opts.esclUrl) return { ok: false, msg: 'eSCL 地址为空', elapsed: 0 }
  const r = await clientProbeUrl(opts.esclUrl, 5000)
  return {
    ...r,
    msg: r.ok ? `eSCL 服务可达（${r.elapsed}ms）` : `eSCL 连接失败：${r.msg}`,
  }
}
