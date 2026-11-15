/**
 * PaperMarker Brother 本地桥接服务
 *
 * 作用：
 *  浏览器无法发起裸 TCP 连接，而 Brother DCP-T428W 的扫描（54921）和打印（9100）
 *  都是裸 TCP 私有协议。本服务运行在用户本地电脑上，把 TCP 协议封装成 HTTP 接口，
 *  浏览器通过 http://localhost:3790 访问本服务，再由本服务直连打印机。
 *
 *  全程本地通信，不经云端。
 *
 * 接口：
 *  GET  /ping                  健康检查（浏览器探测桥接是否运行）
 *  POST /scan                  Brother 扫描 → 返回 JPEG 数组
 *  POST /print                 Brother 直连打印 → 发送 JPEG 到 9100
 *  POST /probe/scan            探测扫描仪 54921
 *  POST /probe/print           探测打印机 9100
 *
 * 启动：
 *  bun run dev   （本地开发，支持热重载）
 *  bun run start （正式运行）
 *
 * 使用：
 *  1. 在与打印机同一局域网的电脑上运行本服务
 *  2. 打开 PaperMarker 网页，设置中选择 Brother 模式
 *  3. 网页自动探测 localhost:3790，通过桥接连打印机
 */
import { serve } from 'bun'
import { jpegToA4Page, assemblePrintStream } from './pwg-encoder'

const PORT = 3790

// CORS + PNA 头：HTTPS 公网页面 → 本地桥接属于 public → local 请求，
// Chrome/WebView 要求预检响应携带 Access-Control-Allow-Private-Network: true
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  // ---------- 健康检查 ----------
  if (path === '/ping' && method === 'GET') {
    return json({ ok: true, service: 'brother-bridge', version: '2.0.0', port: PORT })
  }

  // ---------- Brother 扫描 ----------
  if (path === '/scan' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)

    try {
      const { brotherScanPages } = await import('./brother-scan-impl.ts')
      const r = await brotherScanPages(host, {
        dpi: Number(body.dpi || 300),
        colorMode: body.colorMode || 'CGRAY',
        brightness: Number(body.brightness || 50),
        contrast: Number(body.contrast || 50),
        source: body.source === 'Feeder' ? 'Feeder' : 'Platen',
      })
      if (!r.ok) return json({ ok: false, msg: r.msg, trace: r.trace }, 500)

      // 返回 base64 JPEG 数组
      const pages = r.pages.map((p: any) => ({
        pageNo: p.index,
        base64: Buffer.from(p.buffer).toString('base64'),
        size: p.buffer.length,
      }))
      return json({ ok: true, msg: r.msg, pages, trace: r.trace })
    } catch (e: any) {
      return json({ ok: false, msg: `桥接扫描异常：${e?.message || e}` }, 500)
    }
  }

  // ---------- Brother 直连打印 ----------
  if (path === '/print' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    const jpegs = Array.isArray(body.jpegs) ? body.jpegs : []
    if (jpegs.length === 0) return json({ ok: false, msg: '无可打印页面' }, 400)

    try {
      const buffers = jpegs.map((b: string) => Buffer.from(b, 'base64'))
      // 1. 光栅化：JPEG → A4 @300dpi RGB → PWG Raster 打印流
      const pages = buffers.map((b: Buffer) => jpegToA4Page(b))
      const stream = assemblePrintStream(pages, body.jobName || 'PaperMarker')
      // 2. 直连 9100 发送
      const r = await brotherSendStream(host, stream)
      return json(r, r.ok ? 200 : 500)
    } catch (e: any) {
      return json({ ok: false, msg: `桥接打印异常：${e?.message || e}` }, 500)
    }
  }

  // ---------- 探测扫描仪 ----------
  if (path === '/probe/scan' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    try {
      const { probeBrotherScanner } = await import('./brother-scan-impl.ts')
      const r = await probeBrotherScanner(host)
      return json(r, r.ok ? 200 : 500)
    } catch (e: any) {
      return json({ ok: false, msg: `探测异常：${e?.message || e}` }, 500)
    }
  }

  // ---------- 探测打印机 ----------
  if (path === '/probe/print' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    try {
      const { probeBrotherPrinter } = await import('./brother-scan-impl.ts')
      const r = await probeBrotherPrinter(host)
      return json(r, r.ok ? 200 : 500)
    } catch (e: any) {
      return json({ ok: false, msg: `探测异常：${e?.message || e}` }, 500)
    }
  }

  return json({ ok: false, msg: `未知路径 ${method} ${path}` }, 404)
}

/** PWG Raster 打印流直连 9100 发送 */
async function brotherSendStream(
  host: string,
  stream: Buffer,
  timeoutMs = 120000
): Promise<{ ok: boolean; msg: string }> {
  const { Socket } = await import('net')
  let sock: any = null
  try {
    sock = new Socket()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sock?.destroy()
        reject(new Error(`连接 ${host}:9100 超时`))
      }, 8000)
      sock.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      sock.once('error', (e: Error) => {
        clearTimeout(timer)
        reject(e)
      })
      sock.connect(9100, host)
    })
    const CHUNK = 256 * 1024
    for (let off = 0; off < stream.length; off += CHUNK) {
      const okWrite = sock.write(stream.subarray(off, Math.min(off + CHUNK, stream.length)))
      if (!okWrite) await new Promise<void>((r) => sock.once('drain', () => r()))
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), timeoutMs)
      sock.once('error', () => {
        clearTimeout(t)
        resolve()
      })
      sock.end(() => {
        clearTimeout(t)
        resolve()
      })
    })
    return {
      ok: true,
      msg: `已向 ${host}:9100 下发打印任务（PWGRASTER ${Math.round(stream.length / 1024)}KB）`,
    }
  } catch (e: any) {
    return { ok: false, msg: `Brother 直连打印失败：${e?.message || e}` }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

// ---------- 启动 ----------
console.log('╔══════════════════════════════════════════════════════════╗')
console.log('║  PaperMarker Brother 本地桥接服务                        ║')
console.log('╠══════════════════════════════════════════════════════════╣')
console.log(`║  监听地址：http://localhost:${PORT}                        ║`)
console.log('║  健康检查：GET  /ping                                    ║')
console.log('║  扫描：    POST /scan                                    ║')
console.log('║  打印：    POST /print                                   ║')
console.log('║  探测扫描：POST /probe/scan                              ║')
console.log('║  探测打印：POST /probe/print                             ║')
console.log('╠══════════════════════════════════════════════════════════╣')
console.log('║  全程本地通信，不经云端。                                 ║')
console.log('║  保持本窗口打开，网页会自动探测并连接。                   ║')
console.log('╚══════════════════════════════════════════════════════════╝')

// 处理端口被占用
process.on('uncaughtException', (e: any) => {
  if (e?.code === 'EADDRINUSE' || String(e?.message || '').includes('EADDRINUSE')) {
    console.error('\n❌ 端口 3790 已被占用！请关闭其他桥接实例后重试。')
  } else {
    console.error('未捕获异常:', e?.message || e)
  }
})

serve({
  port: PORT,
  hostname: '0.0.0.0', // 监听所有网卡：手机浏览器可通过局域网 IP 访问本机桥接
  fetch: handleRequest,
})

export {}
