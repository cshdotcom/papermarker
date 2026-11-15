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

const PORT = 3790

// CORS 头：允许任意来源（本地桥接，非公网服务）
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    return json({ ok: true, service: 'brother-bridge', version: '1.0.0', port: PORT })
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
      const { brotherPrintJpegs } = await import('./brother-scan-impl.ts')
      const buffers = jpegs.map((b: string) => Buffer.from(b, 'base64'))
      const r = await brotherPrintJpegs(host, buffers, body.jobName || 'PaperMarker')
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

serve({
  port: PORT,
  hostname: '127.0.0.1', // 只监听本机，不对外
  fetch: handleRequest,
})

export {}
