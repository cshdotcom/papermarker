/**
 * Brother 私有网络扫描协议客户端（TCP 54921）。
 *
 * 协议来源：iPrint&Scan 6.14.2（com.brother.mfc.brprint）SDK 字节码逆向，
 * 已在 DCP-T428W 真机打通（2026-11-14）。
 * 参考：github.com/cshdotcom/brother-dcp-t428w-scan-print
 *
 * 帧格式：1B <命令字符> 0A + ASCII 正文（键=值\n）+ 80
 * 实测最小流程：TCP connect → 等 "+OK 200" → 直接发 ESC X → 进入图像流
 *   （ESC D/E/I 均非必需；先发 ESC I 反而可能把会话带偏）
 *
 * 图像流块结构（10 字节头，实测）：
 *   [0]    0x64 = JPEG 数据块（0x82 = 本页结束，0x80 = 全部结束）
 *   [1-2]  magic 0x0007 小端
 *   [3-4]  页码（从 1 开始）
 *   [5]    0x84 固定标志
 *   [6-7]  进度（随块递增）
 *   [8-9]  保留 0x00 0x00
 *   [10-11] 本块负载长度（小端）
 *   [12..] JPEG 数据（块间直接拼接，页尾见 FFD9）
 */
import net from 'net'

const PORT = 54921
const UEL = Buffer.from([0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58]) // ESC%-12345X

export type BrotherColorMode = 'TEXT' | 'CGRAY' | 'GRAY256' | 'C256' | 'ERRDIF'

export interface BrotherScanParams {
  dpi?: number // 100 / 200 / 300 / 600
  colorMode?: BrotherColorMode // TEXT 黑白二值 / CGRAY 灰度 / C256 彩色
  brightness?: number // 0-100，50 中性
  contrast?: number // 0-100，50 中性
  source?: 'Platen' | 'Feeder' // 平板 / 送稿器
  area?: string // "x,y,w,h" 像素；缺省按 A4 推导
}

export interface BrotherPage {
  index: number
  buffer: Buffer // JPEG
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

/** 带内部缓冲的 Socket 读取器（正确处理 TCP 粘包/拆包） */
class SocketReader {
  private buf: Buffer = Buffer.alloc(0)
  private waiters: Array<{
    n: number
    resolve: (b: Buffer) => void
    reject: (e: Error) => void
    timer: NodeJS.Timeout
  }> = []
  closed = false
  closeErr: Error | null = null

  constructor(private sock: net.Socket) {
    sock.on('data', (d) => this.push(d))
    sock.on('error', (e) => this.fail(e))
    sock.on('close', () => this.fail(new Error('连接中断（设备拒绝连接或会话被占用）')))
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

  /** 精确读 n 字节 */
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
        // 已关闭且数据不足
        clearTimeout(timer)
        reject(this.closeErr || new Error('连接已关闭'))
      }
    })
  }

  /** 读一行（到 \n，丢弃 \r） */
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
      // 暂无换行：收 1 字节（带剩余超时）
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('等待欢迎语超时（设备忙或被原厂 APP 占用）')
      const one = await this.read(1, left)
      s += one.toString('ascii')
    }
  }
}

function connect(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
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

/** 发送一帧命令：ESC <cmd> \n body 0x80 */
function sendFrame(sock: net.Socket, cmd: string, body: string) {
  const head = Buffer.from([0x1b, cmd.charCodeAt(0), 0x0a])
  const tail = Buffer.from([0x80])
  sock.write(Buffer.concat([head, Buffer.from(body, 'ascii'), tail]))
}

/**
 * 探测 Brother 扫描服务（只握手 + ESC D，不动稿台）。
 */
export async function probeBrotherScanner(host: string): Promise<BrotherScanResult> {
  const trace: string[] = []
  let sock: net.Socket | null = null
  try {
    sock = await connect(host, PORT, 6000)
    const rd = new SocketReader(sock)
    const welcome = await rd.readLine(6000)
    trace.push(`welcome: ${welcome}`)
    if (!welcome.startsWith('+')) {
      return { ok: false, msg: `设备未就绪：${welcome || '(空)'}（可能被 iPrint&Scan 占用）`, pages: [], trace }
    }
    // ESC D 设置纸源，验证帧格式
    sendFrame(sock, 'D', 'AUTO\n')
    const st = await rd.read(1, 5000)
    trace.push(`ESC D -> 0x${st[0].toString(16)}`)
    if (st[0] !== 0x80) {
      return { ok: false, msg: `纸源设置失败（状态 0x${st[0].toString(16)}）`, pages: [], trace }
    }
    return {
      ok: true,
      msg: `Brother 扫描服务连通正常（${host}:54921）`,
      pages: [],
      trace,
    }
  } catch (e: any) {
    return { ok: false, msg: `探测失败：${e?.message || e}`, pages: [], trace }
  } finally {
    try {
      sock?.destroy()
    } catch {}
  }
}

/**
 * 执行 Brother 扫描（真机实测最小流程：welcome → ESC X → 图像流）。
 * Feeder 模式自动连续取页（直到 0x80 全部结束）；Platen 单页。
 */
export async function brotherScanPages(
  host: string,
  params: BrotherScanParams = {}
): Promise<BrotherScanResult> {
  const trace: string[] = []
  let sock: net.Socket | null = null
  try {
    const dpi = params.dpi || 300
    const mode = params.colorMode || 'CGRAY'
    const brightness = params.brightness ?? 50
    const contrast = params.contrast ?? 50
    const feeder = params.source === 'Feeder'

    sock = await connect(host, PORT, 6000)
    const rd = new SocketReader(sock)
    const welcome = await rd.readLine(8000)
    trace.push(`welcome: ${welcome}`)
    if (!welcome.startsWith('+')) {
      return { ok: false, msg: `设备未就绪：${welcome || '(空)'}（可能被 iPrint&Scan 占用）`, pages: [], trace }
    }

    const w = mm2px(210, dpi)
    const h = mm2px(297, dpi)
    const area = params.area || `0,0,${w},${h}`

    const xb =
      `R=${dpi},${dpi}\n` +
      `M=${mode}\n` +
      `C=JPEG\n` +
      `J=MID\n` +
      `B=${brightness}\n` +
      `N=${contrast}\n` +
      `A=${area}\n` +
      `D=SIN\n` +
      `G=1\n` +
      `L=128\n`
    sendFrame(sock, 'X', xb)
    trace.push(`ESC X 已发送（${dpi}dpi ${mode} A4${feeder ? ' Feeder' : ''}）`)

    const pages: BrotherPage[] = []
    let cur: Buffer[] = []
    let curLen = 0
    let pageIndex = 0
    const CHUNK_TIMEOUT = 45000 // 600dpi A4 单页约 20MB，给足时间

    while (true) {
      // 10 字节块头
      const hdr = await rd.read(10, CHUNK_TIMEOUT)
      const id = hdr[0]
      if (id === 0x80) {
        // 全部结束
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
        // 控制头族：读 2 字节长度 + 数据
        trace.push(`控制头 id=0x${id.toString(16)}（magic=0x${magic.toString(16)}）`)
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
          if (!feeder) break // 平板模式页结束即完成
        }
        continue
      }
      if (id === 0x82) {
        // 本页结束
        if (curLen > 0) {
          pages.push({ index: pageIndex++, buffer: Buffer.concat(cur) })
          cur = []
          curLen = 0
        }
        trace.push(`第 ${pageId} 页接收完成`)
        if (!feeder) break // 平板模式：一页即止
        continue
      }
      // 0x64 = JPEG 数据块
      const lb = await rd.read(2, 10000)
      const len = lb[0] | (lb[1] << 8)
      if (len === 0) continue
      const payload = await rd.read(len, CHUNK_TIMEOUT)
      cur.push(payload)
      curLen += len
      if (trace.length < 30) trace.push(`已接收 ${curLen} 字节（页 ${pageId}）`)
    }

    // 校验 JPEG 魔数
    const valid = pages.filter(
      (p) => p.buffer.length > 100 && p.buffer[0] === 0xff && p.buffer[1] === 0xd8
    )
    if (valid.length === 0) {
      return {
        ok: false,
        msg: '未收到有效图像数据（平板未放稿 / 会话被占用 / 命令被拒）',
        pages: [],
        trace,
      }
    }
    return {
      ok: true,
      msg: `Brother 扫描完成，共 ${valid.length} 页（${dpi}dpi）`,
      pages: valid,
      trace,
    }
  } catch (e: any) {
    return { ok: false, msg: `扫描异常：${e?.message || e}`, pages: [], trace }
  } finally {
    try {
      sock?.destroy()
    } catch {}
  }
}

/**
 * Brother 9100 端口直连打印（实验路线 C）：
 * PJL 头 + JPEG 字节 + UEL。喷墨机（DCP-T428W 等）PDL 为
 * Jpeg_BH9 族，部分机型接受该封装直接出纸。
 */
export async function brotherPrintJpegs(
  host: string,
  jpegs: Buffer[],
  jobName = 'PaperMarker',
  timeoutMs = 20000
): Promise<{ ok: boolean; msg: string }> {
  if (jpegs.length === 0) return { ok: false, msg: '没有可打印的页面' }
  let sock: net.Socket | null = null
  try {
    sock = await connect(host, 9100, 8000)
    for (let i = 0; i < jpegs.length; i++) {
      const pjl =
        `\n@PJL JOB NAME="${jobName}-${i + 1}"\n` +
        `@PJL ENTER LANGUAGE=JPEG\n`
      const head = Buffer.concat([UEL, Buffer.from(pjl, 'ascii')])
      sock.write(head)
      sock.write(jpegs[i])
      sock.write(UEL)
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        // 9100 写完通常无回包，超时即视为已下发
        resolve()
      }, timeoutMs)
      sock!.once('error', (e) => {
        clearTimeout(t)
        reject(e)
      })
      sock!.end(() => {
        clearTimeout(t)
        resolve()
      })
    })
    return { ok: true, msg: `已向 ${host}:9100 下发 ${jpegs.length} 页直连打印任务` }
  } catch (e: any) {
    return { ok: false, msg: `Brother 直连打印失败：${e?.message || e}` }
  } finally {
    try {
      sock?.destroy()
    } catch {}
  }
}

/**
 * 探测 Brother 打印端口（9100 是否可连）。
 */
export async function probeBrotherPrinter(host: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const sock = await connect(host, 9100, 5000)
    sock.destroy()
    return { ok: true, msg: `打印机 ${host}:9100 端口可达（Brother 直连打印可用）` }
  } catch (e: any) {
    return { ok: false, msg: `打印机 ${host}:9100 连接失败：${e?.message || e}` }
  }
}

export { PORT as BROTHER_SCAN_PORT, UEL as BROTHER_UEL }
