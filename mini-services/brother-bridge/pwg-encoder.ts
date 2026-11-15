/**
 * Brother PWG Raster 打印流编码器（桥接版，纯 JS，无原生依赖，可编译进 .exe）。
 *
 * JPEG 解码用 jpeg-js（纯 JS）。协议见 src/lib/brother-print.ts 顶部注释。
 * 协议来源：官方 brdcpt230filter 逐字节逆向（vituxdxd/brother-dcpt230），
 * DCP-T230/T420W/T428W 同引擎代通用。ENTER LANGUAGE=PWGRASTER 是 Brother 喷墨
 * 固件唯一接受的光栅语言；裸 JPEG（ENTER LANGUAGE=JPEG）会被静默丢弃。
 */
import jpeg from 'jpeg-js'

export const A4_DPI = 300
export const A4_WIDTH_PX = 2480
export const A4_HEIGHT_PX = 3507

const UEL = Buffer.from([0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58])

export interface RasterPage {
  /** RGB 三字节/像素 */
  data: Buffer
  width: number
  height: number
}

function be32(h: Buffer, offset: number, v: number) {
  h[offset] = (v >>> 24) & 0xff
  h[offset + 1] = (v >>> 16) & 0xff
  h[offset + 2] = (v >>> 8) & 0xff
  h[offset + 3] = v & 0xff
}

function buildPreamble(jobName: string, mono: boolean): Buffer {
  const name = (jobName || 'PaperMarker').replace(/["\\\r\n]/g, ' ').slice(0, 60)
  const driver =
    'I000403611' +
    [0, 1, 2, 9, mono ? 1 : 2, 0, 7]
      .map((v) => v.toString(16).toUpperCase().padStart(4, '0'))
      .join('')
  const lines = [
    '@PJL ',
    '@PJL SET HOLD=OFF',
    '@PJL SET STRINGCODESET=UTF8',
    `@PJL SET JOBNAME="${name}"`,
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

function buildPageHeader(width: number, height: number, dpi: number, mono: boolean): Buffer {
  const h = Buffer.alloc(1796)
  h.write('PwgRaster', 0, 'ascii')
  h.write('auto', 128, 'ascii')
  be32(h, 0x114, dpi)
  be32(h, 0x118, dpi)
  be32(h, 0x160, Math.round((width * 72) / dpi))
  be32(h, 0x164, Math.round((height * 72) / dpi))
  be32(h, 0x174, width)
  be32(h, 0x178, height)
  be32(h, 0x180, 8)
  be32(h, 0x184, mono ? 8 : 24)
  be32(h, 0x188, mono ? width : width * 3)
  be32(h, 0x190, mono ? 18 : 19)
  be32(h, 0x1a4, mono ? 1 : 3)
  return h
}

function rleEncodeLine(line: Buffer, width: number, unit: number): Buffer {
  const out: number[] = []
  const pixelEq = (a: number, b: number) => {
    for (let k = 0; k < unit; k++) if (line[a + k] !== line[b + k]) return false
    return true
  }
  let i = 0
  while (i < width) {
    const cur = i * unit
    if (i + 1 < width && pixelEq(cur, cur + unit)) {
      let n = 2
      while (i + n < width && n < 128 && pixelEq(cur, (i + n) * unit)) n++
      out.push(n - 1)
      for (let k = 0; k < unit; k++) out.push(line[cur + k])
      i += n
    } else {
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

function encodePage(page: RasterPage, dpi: number, mono: boolean): Buffer {
  const { data, width, height } = page
  const unit = mono ? 1 : 3
  const parts: Buffer[] = [buildPageHeader(width, height, dpi, mono)]
  let prev: Buffer | null = null
  let prevRle: Buffer | null = null
  let rc = 0
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * width * unit, (y + 1) * width * unit)
    if (prev && rc === 0 && line.equals(prev)) {
      rc = 1
      continue
    }
    if (prev) {
      if (!prevRle) prevRle = rleEncodeLine(prev, width, unit)
      parts.push(Buffer.from([rc]), prevRle)
    }
    prev = Buffer.from(line)
    prevRle = null
    rc = 0
  }
  if (prev) {
    if (!prevRle) prevRle = rleEncodeLine(prev, width, unit)
    parts.push(Buffer.from([rc]), prevRle)
  }
  return Buffer.concat(parts)
}

/** 双线性缩放 + 白底 A4 信箱排版 */
function scaleToA4(rgb: Buffer, srcW: number, srcH: number): RasterPage {
  const W = A4_WIDTH_PX
  const H = A4_HEIGHT_PX
  const out = Buffer.alloc(W * H * 3, 0xff)
  if (srcW <= 0 || srcH <= 0 || rgb.length < srcW * srcH * 3) {
    return { data: out, width: W, height: H }
  }
  const scale = Math.min(W / srcW, H / srcH)
  const dw = Math.max(1, Math.round(srcW * scale))
  const dh = Math.max(1, Math.round(srcH * scale))
  const dx = Math.floor((W - dw) / 2)
  const dy = Math.floor((H - dh) / 2)
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(srcH - 1, ((y + 0.5) / scale) - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(srcW - 1, ((x + 0.5) / scale) - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0
      const q = ((dy + y) * W + dx + x) * 3
      for (let ch = 0; ch < 3; ch++) {
        const p = (x: number, y: number) => rgb[(y * srcW + x) * 3 + ch]
        const top = p(x0, y0) * (1 - fx) + p(x1, y0) * fx
        const bot = p(x0, y1) * (1 - fx) + p(x1, y1) * fx
        out[q + ch] = Math.round(top * (1 - fy) + bot * fy)
      }
    }
  }
  return { data: out, width: W, height: H }
}

/** JPEG → A4 @300dpi RGB 光栅页（jpeg-js 解码，纯 JS） */
export function jpegToA4Page(jpegBuf: Buffer): RasterPage {
  const decoded = jpeg.decode(jpegBuf, {
    formatAsRGBA: false,
    maxMemoryUsageInMB: 1024,
  })
  return scaleToA4(Buffer.from(decoded.data), decoded.width, decoded.height)
}

/** 组装完整打印流（多页；份数由前端重复 jpegs 实现，这里每页一次） */
export function assemblePrintStream(pages: RasterPage[], jobName: string): Buffer {
  const parts: Buffer[] = []
  parts.push(buildPreamble(jobName, false))
  parts.push(Buffer.from('RaS2', 'ascii'))
  for (const pg of pages) {
    parts.push(encodePage(pg, A4_DPI, false))
  }
  const name = (jobName || 'PaperMarker').replace(/["\\\r\n]/g, ' ').slice(0, 60)
  parts.push(UEL)
  parts.push(Buffer.from(`@PJL EOJ NAME="${name}"\r\n`, 'ascii'))
  parts.push(UEL)
  return Buffer.concat(parts)
}
