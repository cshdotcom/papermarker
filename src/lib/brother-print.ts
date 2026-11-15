/**
 * Brother 喷墨打印机 PWG Raster 打印流编码器（服务端版，配合 sharp 解码 JPEG）。
 *
 * 协议来源（真机/官方驱动逆向交叉验证）：
 *  - github.com/vituxdxd/brother-dcpt230（逐字节逆向官方 brdcpt230filter）
 *  - github.com/hwisu/DCP-T420W（国行 DCP-T420W 实测 IPP 属性）
 *  - github.com/swissnp/dcpt230-portable（树莓派真机验证）
 *
 * 关键事实：Brother 喷墨固件 PJL 只认 `@PJL ENTER LANGUAGE=PWGRASTER`，
 * 此前使用的 `ENTER LANGUAGE=JPEG` 不是注册的 language name，会被静默丢弃。
 * 正确链路：UEL + @PJL 头 + PWGRASTER + "RaS2" + 1796B 页头 + RLE 扫描线块 + UEL×2。
 *
 * 线格式（DCP-T230/T420W/T428W 同引擎代通用）：
 *   ESC%-12345X@PJL
 *   @PJL SET HOLD=OFF
 *   @PJL SET STRINGCODESET=UTF8
 *   @PJL SET PAPER=A4
 *   @PJL SET BORDERLESS=OFF
 *   @PJL SET JTTOPMARGIN=300 ... @PJL SET JTRIGHTMARGIN=300
 *   @PJL SET RENDERMODE=COLOR|GRAYSCALE
 *   @PJL SET PRINTQUALITY=NORMAL
 *   @PJL SET DUPLEX=OFF
 *   @PJL SET MEDIATYPE=REGULAR
 *   @PJL SET MANUALFEED=OFF
 *   @PJL SET SOURCETRAY=AUTO
 *   @PJL JOBSETTINGLOG DRIVER=<38字符复合ID>
 *   @PJL SET FIDELITY=TRUE
 *   @PJL ENTER LANGUAGE=PWGRASTER
 *   RaS2                         ← 整个任务一次
 *   <1796B 页头>[rc][RLE 扫描线] × N   ← 每页
 *   ESC%-12345X [@PJL EOJ NAME=".."] ESC%-12345X
 *
 * RLE 码（按扫描线，像素 3 字节 RGB / 1 字节灰度）：
 *   0x00        → 1 个字面像素
 *   0x01–0x7F   → 下一像素重复 (code+1) 次（2–128）
 *   0x81–0xFF   → (0x101-code) 个字面像素（2–128）
 *   0x80 永不出现
 *   行块 = 1 字节 rc（额外重复行数，0 或 1）+ 一条 RLE 扫描线
 */

// A4 @300dpi（官方驱动固定值：2480 × 3507 像素）
export const A4_DPI = 300
export const A4_WIDTH_PX = 2480
export const A4_HEIGHT_PX = 3507

const UEL = Buffer.from([0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58])

export interface BrotherRasterPage {
  /** 像素数据：RGB 三字节/像素 或 单字节灰度 */
  data: Buffer
  width: number
  height: number
}

export interface BrotherPrintOptions {
  /** 颜色模式：color 彩色（默认） | gray 灰度 */
  colorMode?: 'color' | 'gray'
  /** 任务名（写入 JOBNAME/EOJ） */
  jobName?: string
  /** 纸张，当前固定 A4 */
  paper?: 'A4'
  /** 打印份数（每份独立 PJL 任务，与官方驱动 collated copies 行为一致） */
  copies?: number
}

function be32(h: Buffer, offset: number, v: number) {
  h[offset] = (v >>> 24) & 0xff
  h[offset + 1] = (v >>> 16) & 0xff
  h[offset + 2] = (v >>> 8) & 0xff
  h[offset + 3] = v & 0xff
}

/** PJL 前导（UEL 起始，进入 PWGRASTER） */
export function buildPreamble(opts: BrotherPrintOptions = {}): Buffer {
  const mono = opts.colorMode === 'gray'
  const jobName = (opts.jobName || 'PaperMarker').replace(/["\\\r\n]/g, ' ').slice(0, 60)
  // JOBSETTINGLOG DRIVER 复合 ID：I + 型号(7) + "11" + media(4) + quality(4) + paper(4) + color(4) + duplex(4) + slot(4)
  // media: 1 普通纸；quality: 2 NORMAL；paper: 9 A4；color: 1 灰 / 2 彩；duplex: 0 off；slot: 7 AUTO
  const driver =
    'I000403611' +
    [0, 1, 2, 9, mono ? 1 : 2, 0, 7].map((v) => v.toString(16).toUpperCase().padStart(4, '0')).join('')
  const lines = [
    '@PJL ',
    '@PJL SET HOLD=OFF',
    '@PJL SET STRINGCODESET=UTF8',
    `@PJL SET JOBNAME="${jobName}"`,
    '@PJL SET PAPER=A4',
    '@PJL SET BORDERLESS=OFF',
    '@PJL SET JTTOPMARGIN=300',
    '@PJL SET JTBOTMARGIN=300',
    '@PJL SET JTLEFTMARGIN=300',
    '@PJL SET JTRIGHTMARGIN=300',
    `@PJL SET RENDERMODE=${mono ? 'GRAYSCALE' : 'COLOR'}`,
    '@PJL SET PRINTQUALITY=NORMAL',
    '@PJL SET DUPLEX=OFF',
    '@PJL SET MEDIATYPE=REGULAR',
    '@PJL SET MANUALFEED=OFF',
    '@PJL SET SOURCETRAY=AUTO',
    `@PJL JOBSETTINGLOG DRIVER=${driver}`,
    '@PJL SET FIDELITY=TRUE',
    '@PJL ENTER LANGUAGE=PWGRASTER',
  ]
  return Buffer.concat([UEL, Buffer.from(lines.join('\n') + '\n', 'ascii')])
}

/** 1796 字节 PWG 页头 */
export function buildPageHeader(width: number, height: number, dpi: number, mono: boolean): Buffer {
  const h = Buffer.alloc(1796)
  h.write('PwgRaster', 0, 'ascii') // 0x000 MediaClass
  h.write('auto', 128, 'ascii') // 0x080 MediaType
  be32(h, 0x114, dpi) // HWResolution X
  be32(h, 0x118, dpi) // HWResolution Y
  be32(h, 0x160, Math.round((width * 72) / dpi)) // 纸宽（points）
  be32(h, 0x164, Math.round((height * 72) / dpi)) // 纸高（points）
  be32(h, 0x174, width) // 光栅宽（px）
  be32(h, 0x178, height) // 光栅高（px）
  be32(h, 0x180, 8) // bits per channel
  be32(h, 0x184, mono ? 8 : 24) // bits per pixel
  be32(h, 0x188, mono ? width : width * 3) // bytes per line
  be32(h, 0x190, mono ? 18 : 19) // 色彩空间：19 sRGB / 18 sGray
  be32(h, 0x1a4, mono ? 1 : 3) // 色数
  return h
}

/**
 * 单行 RLE 编码（与官方 filter 一致：见前 2 个像素相等即取重复游程，上限 128 像素）。
 * unit = 3（RGB）或 1（灰度）
 */
export function rleEncodeLine(line: Buffer, width: number, unit: number): Buffer {
  const out: number[] = []
  const pixelEq = (a: number, b: number) => {
    for (let k = 0; k < unit; k++) if (line[a + k] !== line[b + k]) return false
    return true
  }
  let i = 0
  while (i < width) {
    const cur = i * unit
    if (i + 1 < width && pixelEq(cur, cur + unit)) {
      // 重复游程：n 个相同像素（2..128）
      let n = 2
      while (i + n < width && n < 128 && pixelEq(cur, (i + n) * unit)) n++
      out.push(n - 1)
      for (let k = 0; k < unit; k++) out.push(line[cur + k])
      i += n
    } else {
      // 字面游程：直到出现「连续两像素相等」或达到 128 像素
      let n = 1
      while (
        i + n < width &&
        n < 128 &&
        !(i + n + 1 < width && pixelEq((i + n) * unit, (i + n + 1) * unit))
      )
        n++
      if (n === 1) out.push(0x00)
      else out.push(0x101 - n)
      for (let k = 0; k < n * unit; k++) out.push(line[cur + k])
      i += n
    }
  }
  return Buffer.from(out)
}

/** RGB 缓冲 → 灰度缓冲（0.3R + 0.59G + 0.11B，与官方 filter 一致） */
export function rgbToGray(rgb: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height)
  for (let p = 0, q = 0; p < width * height; p++, q += 3) {
    out[p] = Math.round(rgb[q] * 0.3 + rgb[q + 1] * 0.59 + rgb[q + 2] * 0.11)
  }
  return out
}

/** 编码一页（页头 + 行块；行块 rc 仅 0/1，与官方 filter 一致） */
export function encodePage(page: BrotherRasterPage, dpi: number, mono: boolean): Buffer {
  const { data, width, height } = page
  const unit = mono ? 1 : 3
  const parts: Buffer[] = [buildPageHeader(width, height, dpi, mono)]
  let prev: Buffer | null = null
  let prevRle: Buffer | null = null
  let rc = 0
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * width * unit, (y + 1) * width * unit)
    if (prev && rc === 0 && line.equals(prev)) {
      // 与上一行完全相同 → 本块覆盖两行（rc=1）
      rc = 1
      continue
    }
    if (prev) {
      if (!prevRle) prevRle = rleEncodeLine(prev, width, unit)
      parts.push(Buffer.from([rc]), prevRle)
    }
    prev = Buffer.from(line) // copy，避免 subarray 引用被覆盖
    prevRle = null
    rc = 0
  }
  if (prev) {
    if (!prevRle) prevRle = rleEncodeLine(prev, width, unit)
    parts.push(Buffer.from([rc]), prevRle)
  }
  return Buffer.concat(parts)
}

/** 双线性缩放 + 白底 A4 信箱式排版（任何输入 → A4_DPI × A4 尺寸 RGB） */
export function scaleToA4(
  rgb: Buffer,
  srcW: number,
  srcH: number,
  mono = false
): { data: Buffer; width: number; height: number } {
  const W = A4_WIDTH_PX
  const H = A4_HEIGHT_PX
  const out = Buffer.alloc(W * H * 3, 0xff) // 白底
  if (srcW <= 0 || srcH <= 0 || rgb.length < srcW * srcH * (mono ? 1 : 3)) {
    return { data: out, width: W, height: H }
  }
  // 保持纵横比，计算放置区域（居中）
  const scale = Math.min(W / srcW, H / srcH)
  const dw = Math.max(1, Math.round(srcW * scale))
  const dh = Math.max(1, Math.round(srcH * scale))
  const dx = Math.floor((W - dw) / 2)
  const dy = Math.floor((H - dh) / 2)
  const unit = mono ? 1 : 3
  const sample = (sx: number, sy: number, ch: number): number => {
    // 双线性采样
    const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)))
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)))
    const x1 = Math.min(srcW - 1, x0 + 1)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fx = sx - x0
    const fy = sy - y0
    const p = (x: number, y: number) => rgb[(y * srcW + x) * unit + ch]
    const top = p(x0, y0) * (1 - fx) + p(x1, y0) * fx
    const bot = p(x0, y1) * (1 - fx) + p(x1, y1) * fx
    return Math.round(top * (1 - fy) + bot * fy)
  }
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) / scale) - 0.5
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) / scale) - 0.5
      const q = ((dy + y) * W + dx + x) * 3
      for (let ch = 0; ch < 3; ch++) {
        if (mono) {
          // 灰度输入：单通道复制到 RGB
          const g = sample(sx, sy, 0)
          out[q + ch] = g
        } else {
          out[q + ch] = sample(sx, sy, ch)
        }
      }
    }
  }
  return { data: out, width: W, height: H }
}

/**
 * 组装完整打印流（多页 + 份数）。
 * 每份拷贝独立一个 PJL 任务（与官方 driver 的 collated copies 行为一致）。
 */
export function assemblePrintStream(
  pages: BrotherRasterPage[],
  opts: BrotherPrintOptions = {}
): Buffer {
  const mono = opts.colorMode === 'gray'
  const parts: Buffer[] = []
  for (let copy = 0; copy < Math.max(1, opts.copies || 1); copy++) {
    parts.push(buildPreamble(opts))
    parts.push(Buffer.from('RaS2', 'ascii')) // 整任务一次
    for (const pg of pages) {
      const data = mono && pg.width * pg.height * 3 === pg.data.length ? rgbToGray(pg.data, pg.width, pg.height) : pg.data
      parts.push(encodePage({ ...pg, data }, A4_DPI, mono))
    }
    const jobName = (opts.jobName || 'PaperMarker').replace(/["\\\r\n]/g, ' ').slice(0, 60)
    parts.push(UEL)
    parts.push(Buffer.from(`@PJL EOJ NAME="${jobName}"\r\n`, 'ascii'))
    parts.push(UEL)
  }
  return Buffer.concat(parts)
}

// ---------- 服务端 sharp 辅助：JPEG → A4 RGB 页 ----------

/** 用 sharp 把 JPEG 缓冲解码并归一化为 A4 @300dpi RGB（服务端专用） */
export async function jpegBufferToA4Page(
  jpeg: Buffer,
  colorMode: 'color' | 'gray' = 'color'
): Promise<BrotherRasterPage> {
  const sharp = (await import('sharp')).default
  const raw = await sharp(jpeg)
    .resize(A4_WIDTH_PX, A4_HEIGHT_PX, {
      fit: 'contain',
      position: 'center',
      background: { r: 255, g: 255, b: 255 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer()
  // sharp 可能返回 3 通道（removeAlpha 后），保险再确认
  if (raw.length !== A4_WIDTH_PX * A4_HEIGHT_PX * 3) {
    throw new Error(`光栅尺寸异常：${raw.length}`)
  }
  if (colorMode === 'gray') {
    const gray = rgbToGray(raw, A4_WIDTH_PX, A4_HEIGHT_PX)
    return { data: gray, width: A4_WIDTH_PX, height: A4_HEIGHT_PX }
  }
  return { data: raw, width: A4_WIDTH_PX, height: A4_HEIGHT_PX }
}
