/**
 * Brother 私有网络协议实现（独立版，用于本地桥接服务）。
 *
 * 协议来源：iPrint&Scan 6.14.2 SDK 字节码逆向，DCP-T428W 真机已打通（2026-11-14）。
 * 参考：github.com/cshdotcom/brother-dcp-t428w-scan-print
 *
 * 帧格式：1B <命令字符> 0A + ASCII 正文（键=值\n）+ 80
 * 实测最小流程：TCP connect → 等 "+OK 200" → 直接发 ESC X → 进入图像流
 */
import { Socket } from 'net'

const PORT = 54921
const UEL = Buffer.from([0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58])

export type BrotherColorMode = 'TEXT' | 'CGRAY' | 'GRAY256' | 'C256' | 'ERRDIF'

export interface BrotherScanParams {
  dpi?: number
  colorMode?: BrotherColorMode
  brightness?: number
  contrast?: number
  source?: 'Platen' | 'Feeder'
  area?: string
}

export interface BrotherPage {
  index: number
  buffer: Buffer
}

export interface BrotherScanResult {
  ok: boolean
  msg: string
  pages: BrotherPage[]
  trace: string[]
}

function mm2px(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi)
}

/** 带内部缓冲的 Socket 读取器 */
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

  constructor(private sock: any) {
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

function connect(host: string, port: number, timeoutMs: number): Promise<any> {
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
    sock.once('error', (e: Error) => {
      clearTimeout(timer)
      reject(e)
    })
    sock.connect(port, host)
  })
}

function sendFrame(sock: any, cmd: string, body: string) {
  const head = Buffer.from([0x1b, cmd.charCodeAt(0), 0x0a])
  const tail = Buffer.from([0x80])
  sock.write(Buffer.concat([head, Buffer.from(body, 'ascii'), tail]))
}

/** 探测 Brother 扫描服务（只握手 + ESC D） */
export async function probeBrotherScanner(host: string): Promise<BrotherScanResult> {
  const trace: string[] = []
  let sock: any = null
  try {
    sock = await connect(host, PORT, 3000)
    const rd = new SocketReader(sock)
    const welcome = await rd.readLine(3000)
    trace.push(`welcome: ${welcome}`)
    if (!welcome.startsWith('+')) {
      return { ok: false, msg: `设备未就绪：${welcome || '(空)'}`, pages: [], trace }
    }
    sendFrame(sock, 'D', 'AUTO\n')
    const st = await rd.read(1, 3000)
    trace.push(`ESC D -> 0x${st[0].toString(16)}`)
    if (st[0] !== 0x80) {
      return { ok: false, msg: `纸源设置失败（0x${st[0].toString(16)}）`, pages: [], trace }
    }
    return { ok: true, msg: `Brother 扫描服务连通（${host}:54921）`, pages: [], trace }
  } catch (e: any) {
    return { ok: false, msg: `探测失败：${e?.message || e}`, pages: [], trace }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

/** 执行 Brother 扫描（真机实测最小流程：welcome → ESC X → 图像流） */
export async function brotherScanPages(
  host: string,
  params: BrotherScanParams = {}
): Promise<BrotherScanResult> {
  const trace: string[] = []
  let sock: any = null
  try {
    const dpi = params.dpi || 300
    const mode = params.colorMode || 'CGRAY'
    const brightness = params.brightness ?? 50
    const contrast = params.contrast ?? 50
    const feeder = params.source === 'Feeder'

    sock = await connect(host, PORT, 4000)
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
    // 彩色模式数据量大（3 倍灰度），超时给足
    const isColor = mode === 'C256' || mode === 'ERRDIF'
    const CHUNK_TIMEOUT = isColor ? 90000 : 45000

    while (true) {
      // 先读 1 字节块类型（协议：1 字节头，bit7=1 为控制头）
      const headBuf = await rd.read(1, CHUNK_TIMEOUT)
      const id = headBuf[0]

      // 0x80 = 整次扫描结束
      if (id === 0x80) {
        if (curLen > 0) {
          pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
          cur = []
          curLen = 0
        }
        trace.push('扫描结束（0x80）')
        break
      }

      // 0x82 = 本页结束，0x83 = 全部结束（控制头族）
      if (id === 0x82 || id === 0x83) {
        // 控制头：读 2 字节长度 + 可能的额外数据
        const lb = await rd.read(2, 5000).catch(() => null)
        if (lb && lb.length === 2) {
          const n = lb[0] | (lb[1] << 8)
          if (n > 0) await rd.read(n, 10000).catch(() => null)
        }
        if (curLen > 0) {
          pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
          cur = []
          curLen = 0
        }
        trace.push(`页结束（0x${id.toString(16)}）`)
        if (id === 0x83) break // AllPagesEnd
        if (!feeder) break // 平板模式单页即止
        continue
      }

      // 其他控制头（0x81/0x84-0x87）：读 2 字节长度 + 跳过数据
      if ((id & 0x80) !== 0) {
        const lb = await rd.read(2, 5000).catch(() => null)
        if (lb && lb.length === 2) {
          const n = lb[0] | (lb[1] << 8)
          if (n > 0) await rd.read(n, 10000).catch(() => null)
        }
        continue
      }

      // 数据块（id & 0x80 == 0）：0x64 = JPEG 数据块
      // 实测头结构 10 字节：[type][magic_lo magic_hi][pageId_lo pageId_hi][0x84][prog_lo prog_hi][00 00]
      // 然后是 2 字节小端块长 + JPEG 数据
      if (id === 0x64) {
        // 读剩余 9 字节头（magic + pageId + flag + progress + reserved）
        const restHdr = await rd.read(9, CHUNK_TIMEOUT)
        const magic = restHdr[0] | (restHdr[1] << 8)
        const pageId = restHdr[2] | (restHdr[3] << 8)
        // 读 2 字节块长
        const lb = await rd.read(2, 10000)
        const len = lb[0] | (lb[1] << 8)
        if (len === 0) continue
        const payload = await rd.read(len, CHUNK_TIMEOUT)
        cur.push(payload)
        curLen += len
        if (trace.length < 30) trace.push(`已接收 ${curLen} 字节（页 ${pageId}，magic=0x${magic.toString(16)}）`)
        continue
      }

      // 其他数据块类型（非 0x64）：按 SDK 协议读 2 字节长度 + 数据
      const lb = await rd.read(2, 10000)
      const len = lb[0] | (lb[1] << 8)
      if (len > 0) {
        const payload = await rd.read(len, CHUNK_TIMEOUT)
        // 非 JPEG 块也追加（可能是分通道数据）
        cur.push(payload)
        curLen += len
      }
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

/** Brother 9100 直连打印（PJL + JPEG + UEL） */
export async function brotherPrintJpegs(
  host: string,
  jpegs: Buffer[],
  jobName = 'PaperMarker',
  timeoutMs = 20000
): Promise<{ ok: boolean; msg: string }> {
  if (jpegs.length === 0) return { ok: false, msg: '没有可打印的页面' }
  let sock: any = null
  try {
    sock = await connect(host, 9100, 5000)
    for (let i = 0; i < jpegs.length; i++) {
      const pjl =
        `\n@PJL JOB NAME="${jobName}-${i + 1}"\n@PJL ENTER LANGUAGE=JPEG\n`
      const head = Buffer.concat([UEL, Buffer.from(pjl, 'ascii')])
      sock.write(head)
      sock.write(jpegs[i])
      sock.write(UEL)
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), timeoutMs)
      sock.once('error', () => { clearTimeout(t); resolve() })
      sock.end(() => { clearTimeout(t); resolve() })
    })
    return { ok: true, msg: `已向 ${host}:9100 下发 ${jpegs.length} 页直连打印任务` }
  } catch (e: any) {
    return { ok: false, msg: `Brother 直连打印失败：${e?.message || e}` }
  } finally {
    try { sock?.destroy() } catch {}
  }
}

/** 探测 Brother 打印端口 9100 */
export async function probeBrotherPrinter(host: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const sock = await connect(host, 9100, 3000)
    sock.destroy()
    return { ok: true, msg: `打印机 ${host}:9100 端口可达` }
  } catch (e: any) {
    return { ok: false, msg: `打印机 ${host}:9100 连接失败：${e?.message || e}` }
  }
}
