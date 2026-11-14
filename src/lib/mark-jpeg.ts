/**
 * 批注页 JPEG 渲染 v2（Brother 9100 直连打印专用）。
 *
 * DCP-T428W 等兄弟喷墨机不走 IPP，直连打印只吃 JPEG，
 * 这里把「原卷图 + 批注标记」直接合成为高分辨率 JPEG：
 * 底图 = origin 图，叠加层 = SVG（题框 / √ / × / 勾上叉 / 每空标记 / 得分 / 顶部宽分数条）。
 * 与前端 annotation-overlay、PDF 批注层共用 answer-layout 布局算法。
 */
import sharp from 'sharp'
import fs from 'fs'
import type { PageImage, RenderLayers } from './pdf-render'
import { normalizeLayers } from './pdf-render'
import {
  computeBackfill,
  computeBlankMarks,
  computeNextTops,
  questionMarkPos,
  parseBlanks,
  truncateForBeside,
  cleanAnswerText,
  cleanSolutionText,
  cleanReasonText,
} from './answer-layout'

const COLORS: Record<string, string> = {
  correct: '#16a34a',
  wrong: '#dc2626',
  partial: '#d97706',
  box: '#2563eb',
  scoreBg: '#1f2937',
  answer: '#15803d',
  reason: '#b45309',
  solution: '#6b7280',
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 答案/错因/解析回填 SVG 片段（v3 小字号，不压题） */
function backfillSvg(a: any, outW: number, outH: number, layers: RenderLayers, nextTopY?: number): string[] {
  if (!layers.answers && !layers.reason && !layers.solution) return []
  const plan = computeBackfill({ ...a, judgeType: a.judgeType, nextTopY })
  // 一题多空：答案已写入每个空内（见 blankMarksSvg），跳过题级答案避免重复重叠
  const hasBlanks = parseBlanks(a.blanksJson).length > 0
  const sv: string[] = []
  const toAbs = (b: { x: number; y: number; w: number; h: number }) => ({
    x: b.x * outW,
    y: b.y * outH,
    w: b.w * outW,
    h: b.h * outH,
  })
  const beside = (m: string) => m === 'beside-mark' || m === 'inline'

  if (layers.answers && plan.answer && !hasBlanks) {
    const b = toAbs(plan.answer)
    const bs = beside(plan.answer.mode)
    const cleaned = cleanAnswerText(a.answerText)
    const text = truncateForBeside(cleaned, bs ? 14 : 24)
    if (text) {
      const fs = Math.max(11, Math.min(b.h * (bs ? 0.82 : 0.7), outW * 0.011))
      sv.push(
        `<rect x="${(b.x - 3).toFixed(1)}" y="${(b.y - 2).toFixed(1)}" width="${(b.w + 6).toFixed(1)}" height="${(b.h + 4).toFixed(1)}" rx="3" fill="#16a34a" fill-opacity="0.12"/>`
      )
      sv.push(
        `<text x="${b.x.toFixed(1)}" y="${(b.y + b.h * 0.78).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="sans-serif" font-weight="700" fill="${COLORS.answer}">答：${esc(text)}</text>`
      )
    }
  }
  if (layers.reason && plan.reason) {
    const b = toAbs(plan.reason)
    const bs = beside(plan.reason.mode)
    const text = truncateForBeside(cleanReasonText(a.briefReason), bs ? 18 : 30)
    if (text) {
      const fs = Math.max(10, Math.min(b.h * 0.8, outW * 0.0095))
      sv.push(
        `<text x="${b.x.toFixed(1)}" y="${(b.y + b.h * 0.8).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="sans-serif" fill="${COLORS.reason}">错因：${esc(text)}</text>`
      )
    }
  }
  if (layers.solution && plan.solution) {
    const b = toAbs(plan.solution)
    const bs = beside(plan.solution.mode)
    const text = truncateForBeside(cleanSolutionText(a.fullSolution || a.briefReason), bs ? 18 : 34)
    if (text) {
      const fs = Math.max(10, Math.min(b.h * 0.8, outW * 0.0095))
      sv.push(
        `<text x="${b.x.toFixed(1)}" y="${(b.y + b.h * 0.8).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="sans-serif" fill="${COLORS.solution}">析：${esc(text)}</text>`
      )
    }
  }
  return sv
}

/** 每空小标记 SVG（v2） */
function blankMarksSvg(a: any, outW: number, outH: number, layers: RenderLayers): string[] {
  if (!layers.marks) return []
  const blanks = parseBlanks(a.blanksJson)
  if (blanks.length === 0) return []
  const sv: string[] = []
  for (const m of computeBlankMarks(blanks)) {
    const cx = m.cx * outW
    const cy = m.cy * outH
    const size = m.size * outW
    const sw = Math.max(1.4, size * 0.14)
    const c = COLORS[m.judge] || COLORS.wrong
    const paths =
      m.judge === 'correct'
        ? ['M4 12.5 L9.5 18 L20 6']
        : m.judge === 'wrong'
          ? ['M6 6 L18 18 M18 6 L6 18']
          : ['M4 12.5 L9.5 18 L20 6', 'M9.2 1.2 L18.6 10.6 M18.6 1.2 L9.2 10.6']
    const widths = m.judge === 'partial' ? [3, 2.6] : [3]
    paths.forEach((p, i) => {
      sv.push(
        `<g transform="translate(${(cx - size / 2).toFixed(1)},${(cy - size / 2).toFixed(1)}) scale(${(size / 24).toFixed(3)})"><path d="${p}" stroke="${c}" stroke-width="${widths[i]}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`
      )
    })
    if (layers.scores && m.scoreText) {
      const fs = Math.max(9, size * 0.5)
      sv.push(
        `<text x="${(cx + size * 0.7).toFixed(1)}" y="${(cy + fs * 0.35).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="sans-serif" font-weight="700" fill="${COLORS.scoreBg}">${m.scoreText}</text>`
      )
    }
    if (layers.answers && m.answerText) {
      const bx = m.box.x * outW
      const by = m.box.y * outH
      const bw = m.box.w * outW
      const bh = m.box.h * outH
      const fs = Math.max(10, Math.min(bh * 0.75, outW * 0.011))
      sv.push(
        `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by + bh / 2 + fs * 0.35).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="sans-serif" font-weight="700" fill="${COLORS.answer}" text-anchor="middle">${esc(m.answerText)}</text>`
      )
    }
  }
  return sv
}

/** 生成判分标记的 SVG path（viewBox 24x24，与前端同款） */
function judgeMarkPath(type: string): { paths: string[]; widths: number[] } {
  if (type === 'correct') return { paths: ['M4 12.5 L9.5 18 L20 6'], widths: [3] }
  if (type === 'wrong') return { paths: ['M6 6 L18 18 M18 6 L6 18'], widths: [3] }
  return {
    paths: ['M4 12.5 L9.5 18 L20 6', 'M9.2 1.2 L18.6 10.6 M18.6 1.2 L9.2 10.6'],
    widths: [3, 2.6],
  }
}

export interface MarkJpegPage {
  pageNo: number
  jpeg: Buffer
}

export interface RenderJpegOpts {
  withImage?: boolean
  width?: number
  layers?: RenderLayers
  meta?: { paperName?: string; studentName?: string | null }
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
  opts: RenderJpegOpts = {}
): Promise<MarkJpegPage[]> {
  const withImage = opts.withImage !== false
  const layers = normalizeLayers(opts.layers)
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
    // v3：下一题顶界限制回填位置
    const nextTops = computeNextTops(list)

    // SVG 叠加层（与底图同尺寸）
    const sv: string[] = []

    // 顶部宽分数条（v2）：练习名 | 学生 得分 | 日期·页码
    if (layers.banner) {
      const m = Math.round(outW * 0.03)
      const tagH = Math.round(outW * 0.026)
      const tagY = Math.round(outW * 0.018)
      const tagW = outW - m * 2
      sv.push(
        `<rect x="${m}" y="${tagY}" width="${tagW}" height="${tagH}" rx="${Math.round(tagH * 0.2)}" fill="${COLORS.scoreBg}"/>`
      )
      const paper = String(opts.meta?.paperName || '未命名试卷')
      const paperTxt = paper.length > 18 ? paper.slice(0, 18) + '…' : paper
      const student = String(opts.meta?.studentName || '').trim()
      const date = new Date().toISOString().slice(0, 10)
      const fs1 = Math.max(11, Math.round(tagH * 0.46))
      const cy = tagY + tagH / 2
      sv.push(
        `<text x="${m + Math.round(tagH * 0.35)}" y="${(cy + fs1 * 0.35).toFixed(1)}" font-size="${fs1}" font-family="sans-serif" font-weight="700" fill="#ffffff">${esc(paperTxt)}</text>`
      )
      sv.push(
        `<text x="${m + Math.round(tagW * 0.5)}" y="${(cy + fs1 * 0.35).toFixed(1)}" font-size="${fs1}" font-family="sans-serif" fill="#ffffff" text-anchor="middle">${esc(`${student ? student + ' ' : ''}得分 ${pageGetSum}/${pageFullSum}（总 ${totalGet}/${totalFull}）`)}</text>`
      )
      sv.push(
        `<text x="${m + tagW - Math.round(tagH * 0.35)}" y="${(cy + fs1 * 0.35).toFixed(1)}" font-size="${fs1}" font-family="sans-serif" fill="#ffffff" text-anchor="end">${esc(`${date} · 第${pageNo}/${pageNos.length}页`)}</text>`
      )
    }

    for (const a of list) {
      const bx = (a.roiX || 0) * outW
      const by = (a.roiY || 0) * outH
      const bw = (a.roiW || 0) * outW
      const bh = (a.roiH || 0) * outH
      if (bw < 8 || bh < 8) continue

      if (withImage && layers.boxes) {
        // 题框
        sv.push(
          `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${COLORS.box}" fill-opacity="0.05" stroke="${COLORS.box}" stroke-width="${Math.max(1, outW * 0.001).toFixed(1)}"/>`
        )
      }

      // 题级判分标记（题号旁，v3 小号）
      if (layers.marks) {
        const mp = questionMarkPos({ x: a.roiX || 0, y: a.roiY || 0, w: a.roiW || 0, h: a.roiH || 0 })
        const mx = mp.cx * outW
        const my = mp.cy * outH
        const markSize = Math.max(12, mp.size * outW)
        const { paths, widths } = judgeMarkPath(a.judgeType)
        const c = COLORS[a.judgeType] || COLORS.wrong
        paths.forEach((p, i) => {
          sv.push(
            `<g transform="translate(${(mx - markSize / 2).toFixed(1)},${(my - markSize / 2).toFixed(1)}) scale(${(markSize / 24).toFixed(3)})"><path d="${p}" stroke="${c}" stroke-width="${widths[i]}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`
          )
        })
      }

      // 每题得分（小字，框内右下角；单空题已有空旁小得分，不重复）
      if (layers.scores) {
        const blanks = parseBlanks(a.blanksJson)
        const singleBlankScored = blanks.length === 1 && blanks[0].fullScore > 0
        if (!singleBlankScored) {
          const fs2 = Math.max(9, Math.round(outW * 0.0085))
          sv.push(
            `<text x="${(bx + bw - 4).toFixed(1)}" y="${(by + bh - fs2 * 0.3).toFixed(1)}" font-size="${fs2}" font-family="sans-serif" font-weight="700" fill="${COLORS.scoreBg}" text-anchor="end">${a.getScore}/${a.fullScore}</text>`
          )
        }
      }

      // 每空小标记
      sv.push(...blankMarksSvg(a, outW, outH, layers))

      // 答案/错因/解析回填（v3：下一题顶界限制，不压题）
      if (withImage) sv.push(...backfillSvg(a, outW, outH, layers, nextTops?.get(a.id)))
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
