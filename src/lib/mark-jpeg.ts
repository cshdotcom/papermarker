/**
 * 批注页 JPEG 渲染（Brother 9100 直连打印专用）。
 *
 * 由于 DCP-T428W 等兄弟喷墨机不走 IPP，直连打印只吃 JPEG，
 * 这里把「原卷图 + 批注标记」直接合成为高分辨率 JPEG：
 * 底图 = origin 图，叠加层 = SVG（题框 / √ / × / 勾上叉 / 得分 / 页首分数条）。
 * 标记画法与前端 annotation-overlay、PDF 批注层保持同款样式。
 */
import sharp from 'sharp'
import fs from 'fs'
import type { PageImage } from './pdf-render'

const COLORS: Record<string, string> = {
  correct: '#16a34a',
  wrong: '#dc2626',
  partial: '#d97706',
  box: '#2563eb',
  scoreBg: '#1f2937',
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 生成判分标记的 SVG path（viewBox 24x24，与前端同款） */
function judgeMarkPath(type: string): { paths: string[]; widths: number[] } {
  if (type === 'correct') return { paths: ['M4 12.5 L9.5 18 L20 6'], widths: [3] }
  if (type === 'wrong') return { paths: ['M6 6 L18 18 M18 6 L6 18'], widths: [3] }
  // 半对：完整勾 + 上方叉
  return {
    paths: ['M4 12.5 L9.5 18 L20 6', 'M9.2 1.2 L18.6 10.6 M18.6 1.2 L9.2 10.6'],
    widths: [3, 2.6],
  }
}

export interface MarkJpegPage {
  pageNo: number
  jpeg: Buffer
}

/**
 * 把一个任务的批注重染为 JPEG 页数组。
 * @param pageImages pageNo → 原图（path/w/h）
 * @param annotations 批注列表（相对 ROI 坐标）
 * @param opts.withImage false 时输出纯标记层（白底只有标记，套印用）
 */
export async function renderAnnotatedJpegs(
  pageImages: Map<number, PageImage>,
  annotations: any[],
  opts: { withImage?: boolean; width?: number } = {}
): Promise<MarkJpegPage[]> {
  const withImage = opts.withImage !== false
  const outW = opts.width || 1240 // A4 @150dpi，喷墨打印足够清晰
  const out: MarkJpegPage[] = []

  const pageSet = new Set<number>(pageImages.keys())
  for (const a of annotations) pageSet.add(a.pageNo || 1)
  if (pageSet.size === 0) pageSet.add(1)
  const pageNos = Array.from(pageSet).sort((a, b) => a - b)

  let totalGet = 0
  let totalFull = 0
  for (const a of annotations) {
    totalGet += a.getScore || 0
    totalFull += a.fullScore || 0
  }

  for (const pageNo of pageNos) {
    const pg = pageImages.get(pageNo)
    if (!pg || !fs.existsSync(pg.path)) continue
    const img = sharp(pg.path)
    const meta = await img.metadata()
    const iw = meta.width || pg.w || 1000
    const ih = meta.height || pg.h || 1414
    const outH = Math.round((outW * ih) / iw)
    // 先统一缩放底图
    const base = await img.resize(outW, outH, { fit: 'fill' }).toBuffer()

    const list = annotations.filter((a) => (a.pageNo || 1) === pageNo)
    let pageGetSum = 0
    let pageFullSum = 0
    for (const a of list) {
      pageGetSum += a.getScore || 0
      pageFullSum += a.fullScore || 0
    }

    // SVG 叠加层（与底图同尺寸）
    const sv: string[] = []
    // 页首分数条
    const tagW = Math.round(outW * 0.4)
    const tagH = Math.round(outW * 0.024)
    const tagX = outW - tagW - Math.round(outW * 0.04)
    sv.push(
      `<rect x="${tagX}" y="${Math.round(outW * 0.02)}" width="${tagW}" height="${tagH}" rx="${Math.round(tagH * 0.28)}" fill="${COLORS.scoreBg}"/>`
    )
    const fs1 = Math.max(11, Math.round(tagH * 0.5))
    sv.push(
      `<text x="${tagX + tagW - Math.round(tagH * 0.35)}" y="${Math.round(outW * 0.02) + tagH * 0.68}" font-size="${fs1}" font-family="sans-serif" font-weight="700" fill="#ffffff" text-anchor="end">第 ${pageNo} 页 ${pageGetSum}/${pageFullSum} 总分 ${totalGet}/${totalFull}</text>`
    )

    for (const a of list) {
      const bx = (a.roiX || 0) * outW
      const by = (a.roiY || 0) * outH
      const bw = (a.roiW || 0) * outW
      const bh = (a.roiH || 0) * outH
      if (bw < 8 || bh < 8) continue

      if (withImage) {
        // 题框
        sv.push(
          `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${COLORS.box}" fill-opacity="0.06" stroke="${COLORS.box}" stroke-width="${Math.max(1, outW * 0.0012).toFixed(1)}"/>`
        )
      }

      // 判分标记（右上角内侧）
      const markSize = Math.max(18, Math.min(bh, outW * 0.03))
      const mx = bx + bw - markSize * 0.85
      const my = by + markSize * 0.1
      const { paths, widths } = judgeMarkPath(a.judgeType)
      const c = COLORS[a.judgeType] || COLORS.wrong
      paths.forEach((p, i) => {
        sv.push(
          `<g transform="translate(${mx.toFixed(1)},${my.toFixed(1)}) scale(${(markSize / 24).toFixed(3)})"><path d="${p}" stroke="${c}" stroke-width="${widths[i]}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`
        )
      })

      // 得分数字
      const fs2 = Math.max(10, Math.round(markSize * 0.42))
      sv.push(
        `<text x="${(bx + bw - 4).toFixed(1)}" y="${(by + bh + fs2).toFixed(1)}" font-size="${fs2}" font-family="sans-serif" font-weight="700" fill="${COLORS.scoreBg}" text-anchor="end">${a.getScore}/${a.fullScore}</text>`
      )
    }

    const overlaySvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">${sv.join('')}</svg>`
    )

    const baseImg = withImage
      ? base
      : await sharp({
          create: { width: outW, height: outH, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer()

    const jpeg = await sharp(baseImg)
      .composite([{ input: overlaySvg }])
      .jpeg({ quality: 90 })
      .toBuffer()
    out.push({ pageNo, jpeg })
  }
  return out
}

/** 原图直接转打印用 JPEG（快速复印 / 原卷回放） */
export async function imageToPrintJpeg(absPath: string, width = 1240): Promise<Buffer> {
  return sharp(absPath).resize({ width, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
}
