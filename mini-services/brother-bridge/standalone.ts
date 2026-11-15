/**
 * PaperMarker Brother 本地桥接服务（独立单文件，可编译为 .exe）
 *
 * 作用：
 *  浏览器无法发起裸 TCP，而 Brother 54921/9100 是裸 TCP 私有协议。
 *  本服务运行在用户本地电脑，把 TCP 封装成 HTTP，浏览器经 localhost 调用。
 *  全程本地，不经云端。
 *
 * 编译为 Windows .exe：
 *  bun build mini-services/brother-bridge/standalone.ts --compile --target=bun-windows-x64 --outfile public/papermarker-bridge.exe
 *
 * 运行：
 *  双击 papermarker-bridge.exe（Windows）
 *  或 bun run standalone.ts（开发）
 */
import { Socket } from 'net'
import { serve } from 'bun'

const PORT = 3790
const SCAN_PORT = 54921
const PRINT_PORT = 9100
const UEL = Buffer.from([0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58])

// ---------- HTTP ----------
function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

// ---------- TCP ----------
function connect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = new Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`连接 ${host}:${port} 超时`))
    }, timeoutMs)
    sock.once('connect', () => {
      clearTimeout(timer)
      resolve(sock)
    })
    sock.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    sock.connect(port, host)
  })
}

class SocketReader {
  private buf: Buffer = Buffer.alloc(0)
  private waiters: Array<{
    n: number
    resolve: (b: Buffer) => void
    reject: (e: Error) => void
    timer: Timer
  }> = []
  closed = false
  closeErr: Error | null = null

  constructor(private sock: Socket) {
    sock.on('data', (d: Buffer) => this.push(d))
    sock.on('error', (e: Error) => this.fail(e))
    sock.on('close', () => this.fail(new Error('连接中断（设备拒绝或会话被占用）')))
  }

  private push(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d])
    this.drain()
  }

  private fail(e: Error) {
    this.closed = true
    this.closeErr = e
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(e)
    }
    this.waiters = []
  }

  private drain() {
    while (this.waiters.length > 0 && this.buf.length >= this.waiters[0].n) {
      const w = this.waiters.shift()!
      clearTimeout(w.timer)
      const out = this.buf.subarray(0, w.n)
      this.buf = this.buf.subarray(w.n)
      w.resolve(out)
    }
  }

  read(n: number, timeoutMs: number): Promise<Buffer> {
    if (n <= 0) return Promise.resolve(Buffer.alloc(0))
    if (this.buf.length >= n) {
      const out = this.buf.subarray(0, n)
      this.buf = this.buf.subarray(n)
      return Promise.resolve(out)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === resolve)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error(`读取超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.waiters.push({ n, resolve, reject, timer })
      if (this.closed) {
        clearTimeout(timer)
        reject(this.closeErr || new Error('连接已关闭'))
      }
    })
  }

  async readLine(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let s = ''
    while (true) {
      const i = this.buf.indexOf(0x0a)
      if (i >= 0) {
        const line = this.buf.subarray(0, i)
        this.buf = this.buf.subarray(i + 1)
        return s + line.toString('ascii').replace(/\r/g, '')
      }
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('等待欢迎语超时（设备忙或被原厂 APP 占用）')
      const one = await this.read(1, left)
      s += one.toString('ascii')
    }
  }
}

function sendFrame(sock: Socket, cmd: string, body: string) {
  const head = Buffer.from([0x1b, cmd.charCodeAt(0), 0x0a])
  const tail = Buffer.from([0x80])
  sock.write(Buffer.concat([head, Buffer.from(body, 'ascii'), tail]))
}

function mm2px(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi)
}

// ---------- Brother 扫描 ----------
interface BrotherPage {
  index: number
  buffer: Buffer
}

async function brotherScanPages(
  host: string,
  params: {
    dpi?: number
    colorMode?: string
    brightness?: number
    contrast?: number
    source?: string
    area?: string
  }
): Promise<{ ok: boolean; msg: string; pages: BrotherPage[]; trace: string[] }> {
  const trace: string[] = []
  let sock: Socket | null = null
  try {
    const dpi = params.dpi || 300
    const mode = params.colorMode || 'CGRAY'
    const brightness = params.brightness ?? 50
    const contrast = params.contrast ?? 50
    const feeder = params.source === 'Feeder'

    sock = await connect(host, SCAN_PORT, 4000)
    const rd = new SocketReader(sock)
    const welcome = await rd.readLine(4000)
    trace.push(`welcome: ${welcome}`)
    if (!welcome.startsWith('+')) {
      return { ok: false, msg: `设备未就绪：${welcome || '(空)'}`, pages: [], trace }
    }

    const w = mm2px(210, dpi)
    const h = mm2px(297, dpi)
    const area = params.area || `0,0,${w},${h}`
    const xb =
      `R=${dpi},${dpi}\nM=${mode}\nC=JPEG\nJ=MID\n` +
      `B=${brightness}\nN=${contrast}\nA=${area}\n` +
      `D=SIN\nG=1\nL=128\n`
    sendFrame(sock, 'X', xb)
    trace.push(`ESC X 已发送（${dpi}dpi ${mode} A4${feeder ? ' Feeder' : ''}）`)

    const pages: BrotherPage[] = []
    let cur: Buffer[] = []
    let curLen = 0
    let pageIndex = 0
    const CHUNK_TIMEOUT = 45000

    while (true) {
      const hdr = await rd.read(10, CHUNK_TIMEOUT)
      const id = hdr[0]
      if (id === 0x80) {
        if (curLen > 0) {
          pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
          cur = []
          curLen = 0
        }
        break
      }
      const magic = hdr[1] | (hdr[2] << 8)
      const pageId = hdr[3] | (hdr[4] << 8)
      if (magic !== 0x0007) {
        const lb = await rd.read(2, 5000).catch(() => null)
        if (lb && lb.length === 2) {
          const n = lb[0] | (lb[1] << 8)
          if (n > 0) await rd.read(n, 10000).catch(() => null)
        }
        if (id === 0x82 || id === 0x83) {
          if (curLen > 0) {
            pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
            cur = []
            curLen = 0
          }
          if (id === 0x83) break
          if (!feeder) break
        }
        continue
      }
      if (id === 0x82) {
        if (curLen > 0) {
          pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
          cur = []
          curLen = 0
        }
        trace.push(`第 ${pageId} 页接收完成`)
        if (!feeder) break
        continue
      }
      const lb = await rd.read(2, 10000)
      const len = lb[0] | (lb[1] << 8)
      if (len === 0) continue
      const payload = await rd.read(len, CHUNK_TIMEOUT)
      cur.push(payload)
      curLen += len
      if (trace.length < 30) trace.push(`已接收 ${curLen} 字节（页 ${pageId}）`)
    }

    const valid = pages.filter(
      (p) => p.buffer.length > 100 && p.buffer[0] === 0xff && p.buffer[1] === 0xd8
    )
    if (valid.length === 0) {
      return { ok: false, msg: '未收到有效图像（平板未放稿 / 会话被占用）', pages: [], trace }
    }
    return {
      ok: true,
      msg: `扫描完成，共 ${valid.length} 页（${dpi}dpi）`,
      pages: valid,
      trace,
    }
  } catch (e: any) {
    return { ok: false, msg: `扫描异常：${e?.message || e}`, pages: [], trace }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

// ---------- Brother 直连打印 ----------
async function brotherPrintJpegs(
  host: string,
  jpegs: Buffer[],
  jobName = 'PaperMarker',
  timeoutMs = 20000
): Promise<{ ok: boolean; msg: string }> {
  if (jpegs.length === 0) return { ok: false, msg: '没有可打印的页面' }
  let sock: Socket | null = null
  try {
    sock = await connect(host, PRINT_PORT, 5000)
    for (let i = 0; i < jpegs.length; i++) {
      const pjl = `\n@PJL JOB NAME="${jobName}-${i + 1}"\n@PJL ENTER LANGUAGE=JPEG\n`
      const head = Buffer.concat([UEL, Buffer.from(pjl, 'ascii')])
      sock.write(head)
      sock.write(jpegs[i])
      sock.write(UEL)
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), timeoutMs)
      sock!.once('error', () => { clearTimeout(t); resolve() })
      sock!.end(() => { clearTimeout(t); resolve() })
    })
    return { ok: true, msg: `已向 ${host}:9100 下发 ${jpegs.length} 页直连打印任务` }
  } catch (e: any) {
    return { ok: false, msg: `Brother 直连打印失败：${e?.message || e}` }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

// ---------- Brother 探测 ----------
async function probeScanner(host: string): Promise<{ ok: boolean; msg: string }> {
  const trace: string[] = []
  let sock: Socket | null = null
  try {
    sock = await connect(host, SCAN_PORT, 3000)
    const rd = new SocketReader(sock)
    const welcome = await rd.readLine(3000)
    trace.push(`welcome: ${welcome}`)
    if (!welcome.startsWith('+')) {
      return { ok: false, msg: `设备未就绪：${welcome || '(空)'}` }
    }
    sendFrame(sock, 'D', 'AUTO\n')
    const st = await rd.read(1, 3000)
    trace.push(`ESC D -> 0x${st[0].toString(16)}`)
    if (st[0] !== 0x80) {
      return { ok: false, msg: `纸源设置失败（0x${st[0].toString(16)}）` }
    }
    return { ok: true, msg: `Brother 扫描服务连通（${host}:54921）` }
  } catch (e: any) {
    return { ok: false, msg: `探测失败：${e?.message || e}` }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

async function probePrinter(host: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const sock = await connect(host, PRINT_PORT, 3000)
    sock.destroy()
    return { ok: true, msg: `打印机 ${host}:9100 端口可达` }
  } catch (e: any) {
    return { ok: false, msg: `打印机 ${host}:9100 连接失败：${e?.message || e}` }
  }
}

// ---------- HTTP 服务 ----------
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (path === '/ping' && method === 'GET') {
    return json({ ok: true, service: 'brother-bridge', version: '1.0.0', port: PORT })
  }

  // Brother 扫描
  if (path === '/scan' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    try {
      const r = await brotherScanPages(host, {
        dpi: Number(body.dpi || 300),
        colorMode: body.colorMode || 'CGRAY',
        brightness: Number(body.brightness || 50),
        contrast: Number(body.contrast || 50),
        source: body.source === 'Feeder' ? 'Feeder' : 'Platen',
      })
      if (!r.ok) return json({ ok: false, msg: r.msg, trace: r.trace }, 500)
      const pages = r.pages.map((p) => ({
        pageNo: p.index,
        base64: Buffer.from(p.buffer).toString('base64'),
        size: p.buffer.length,
      }))
      return json({ ok: true, msg: r.msg, pages, trace: r.trace })
    } catch (e: any) {
      return json({ ok: false, msg: `桥接扫描异常：${e?.message || e}` }, 500)
    }
  }

  // Brother 直连打印
  if (path === '/print' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    const jpegs = Array.isArray(body.jpegs) ? body.jpegs : []
    if (jpegs.length === 0) return json({ ok: false, msg: '无可打印页面' }, 400)
    try {
      const buffers = jpegs.map((b: string) => Buffer.from(b, 'base64'))
      const r = await brotherPrintJpegs(host, buffers, body.jobName || 'PaperMarker')
      return json(r, r.ok ? 200 : 500)
    } catch (e: any) {
      return json({ ok: false, msg: `桥接打印异常：${e?.message || e}` }, 500)
    }
  }

  // 探测扫描仪
  if (path === '/probe/scan' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    const r = await probeScanner(host)
    return json(r, r.ok ? 200 : 500)
  }

  // 探测打印机
  if (path === '/probe/print' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const host = String(body.host || '').trim()
    if (!host) return json({ ok: false, msg: '缺少 host 参数' }, 400)
    const r = await probePrinter(host)
    return json(r, r.ok ? 200 : 500)
  }

  return json({ ok: false, msg: `未知路径 ${method} ${path}` }, 404)
}

// ---------- 启动 ----------
const BANNER = `
╔══════════════════════════════════════════════════════════╗
║  PaperMarker Brother 本地桥接服务                        ║
╠══════════════════════════════════════════════════════════╣
║  监听地址：http://localhost:${PORT}                        ║
║  健康检查：GET  /ping                                    ║
║  扫描：    POST /scan                                    ║
║  打印：    POST /print                                   ║
║  探测扫描：POST /probe/scan                              ║
║  探测打印：POST /probe/print                             ║
╠══════════════════════════════════════════════════════════╣
║  全程本地通信，不经云端。                                 ║
║  保持本窗口打开，网页会自动探测并连接。                   ║
║  关闭本窗口即停止桥接服务。                               ║
╚══════════════════════════════════════════════════════════╝
`

console.log(BANNER)

// 处理端口被占用：EADDRINUSE 时提示用户并退出（而非静默崩溃）
process.on('uncaughtException', (e: any) => {
  if (e?.code === 'EADDRINUSE') {
    console.error('\n❌ 端口 3790 已被占用！')
    console.error('   可能是另一个桥接服务已在运行。')
    console.error('   请关闭其他实例后重试。')
    console.error('   按任意键退出...')
    process.stdin.resume()
    process.stdin.once('data', () => process.exit(1))
  } else {
    console.error('未捕获异常:', e?.message || e)
  }
})

try {
  serve({
    port: PORT,
    hostname: '127.0.0.1',
    fetch: handleRequest,
  })
} catch (e: any) {
  if (e?.code === 'EADDRINUSE' || String(e?.message || '').includes('EADDRINUSE')) {
    console.error('\n❌ 端口 3790 已被占用！请关闭其他桥接实例后重试。')
    console.error('   按任意键退出...')
    process.stdin.resume()
    process.stdin.once('data', () => process.exit(1))
  } else {
    throw e
  }
}
