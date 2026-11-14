import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { db } from './db'
import { pdfDir, relPath, absPath } from './storage'
import {
  computeBackfill,
  computeBlankMarks,
  parseBlanks,
  truncateForBeside,
  cleanAnswerText,
  cleanSolutionText,
  cleanReasonText,
  MARK_SIZE_Q,
} from './answer-layout'

export type JudgeType = 'correct' | 'wrong' | 'partial'

export interface PageImage {
  path: string
  w: number
  h: number
}

/** 渲染图层开关（与前端 MarkLayers 一致） */
export interface RenderLayers {
  marks: boolean
  scores: boolean
  answers: boolean
  reason: boolean
  solution: boolean
  boxes: boolean
  banner: boolean
}

export const DEFAULT_LAYERS: RenderLayers = {
  marks: true,
  scores: true,
  answers: true,
  reason: true,
  solution: false,
  boxes: true,
  banner: true,
}

export function normalizeLayers(raw: any): RenderLayers {
  const l = { ...DEFAULT_LAYERS }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_LAYERS) as (keyof RenderLayers)[]) {
      if (typeof raw[k] === 'boolean') l[k] = raw[k]
    }
  }
  return l
}

export interface RenderMarkInput {
  taskId: string
  pageImages: Map<number, PageImage> // pageNo → 图片
  annotations: any[]
  /** 顶部宽分数条信息 */
  meta?: {
    paperName?: string
    studentName?: string | null
    printDate?: Date
  }
  layers?: RenderLayers
}

const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 24
/** 顶部宽分数条高度 */
const BANNER_H = 30

const COLORS = {
  correct: '#16a34a', // green
  wrong: '#dc2626', // red
  partial: '#d97706', // amber
  box: '#2563eb',
  scoreBg: '#1f2937',
  scoreText: '#ffffff',
  answer: '#15803d',
  reason: '#b45309',
  solution: '#6b7280',
}

// ---------- 中文字体（解决导出乱码） ----------
const FONT_DIRS = [
  path.join(process.cwd(), 'assets', 'fonts'),
  '/usr/share/fonts/truetype/chinese',
]

function findFont(name: string): string | null {
  for (const d of FONT_DIRS) {
    const p = path.join(d, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

const CJK_REG_PATH = findFont('NotoSansSC-Regular.ttf')
const CJK_BOLD_PATH = findFont('NotoSansSC-Bold.ttf')

const F_REG = CJK_REG_PATH ? 'cjk' : 'Helvetica'
const F_BOLD = CJK_BOLD_PATH ? 'cjk-bold' : 'Helvetica-Bold'

function registerCjk(doc: PDFDocument) {
  if (CJK_REG_PATH) doc.registerFont('cjk', CJK_REG_PATH)
  if (CJK_BOLD_PATH) doc.registerFont('cjk-bold', CJK_BOLD_PATH)
}

/** 把图片等比缩放铺到 A4 页面可用区域，返回绘图矩形 */
function fitRect(imgW: number, imgH: number) {
  const availW = A4_W - MARGIN * 2
  const availH = A4_H - MARGIN * 2 - BANNER_H
  if (!imgW || !imgH) {
    return { x: MARGIN, y: MARGIN + BANNER_H, w: availW, h: availH }
  }
  const scale = Math.min(availW / imgW, availH / imgH)
  const w = imgW * scale
  const h = imgH * scale
  const x = MARGIN + (availW - w) / 2
  const y = MARGIN + BANNER_H + (availH - h) / 2
  return { x, y, w, h }
}

/** 绘制 √ 勾（绿色） */
function drawCheck(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  doc.save()
  doc.lineWidth(Math.max(0.8, size * 0.14))
  doc.strokeColor(color)
  doc.lineCap('round')
  doc.moveTo(cx - size * 0.4, cy)
  doc.lineTo(cx - size * 0.08, cy + size * 0.32)
  doc.lineTo(cx + size * 0.42, cy - size * 0.34)
  doc.stroke()
  doc.restore()
}

/** 绘制 × 叉（红色） */
function drawCross(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  doc.save()
  doc.lineWidth(Math.max(0.8, size * 0.14))
  doc.strokeColor(color)
  doc.lineCap('round')
  doc.moveTo(cx - size * 0.35, cy - size * 0.35)
  doc.lineTo(cx + size * 0.35, cy + size * 0.35)
  doc.moveTo(cx + size * 0.35, cy - size * 0.35)
  doc.lineTo(cx - size * 0.35, cy + size * 0.35)
  doc.stroke()
  doc.restore()
}

/** 绘制半对标记 ⍻：完整勾 + 勾上部小叉（矢量，非字符） */
function drawHalfCheck(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  drawCheck(doc, cx, cy, size, color)
  doc.save()
  doc.lineWidth(Math.max(0.7, size * 0.11))
  doc.strokeColor(color)
  doc.lineCap('round')
  const r = size * 0.2
  const xc = cx + size * 0.08
  const yc = cy - size * 0.26
  doc.moveTo(xc - r, yc - r)
  doc.lineTo(xc + r, yc + r)
  doc.moveTo(xc + r, yc - r)
  doc.lineTo(xc - r, yc + r)
  doc.stroke()
  doc.restore()
}

function drawJudgeMark(
  doc: PDFDocument,
  judge: JudgeType,
  x: number,
  y: number,
  size: number
) {
  if (judge === 'correct') drawCheck(doc, x, y, size, COLORS.correct)
  else if (judge === 'wrong') drawCross(doc, x, y, size, COLORS.wrong)
  else drawHalfCheck(doc, x, y, size, COLORS.partial)
}

/**
 * 顶部宽分数条（v2）：
 * 【练习名称】 学生：XXX 得分 x/y · 打印日期 YYYY-MM-DD · 第 N/M 页
 */
function drawBanner(
  doc: PDFDocument,
  meta: RenderMarkInput['meta'],
  pageNo: number,
  totalPages: number,
  pageGet: number,
  pageFull: number,
  totalGet: number,
  totalFull: number
) {
  const x = MARGIN
  const y = MARGIN - 6
  const w = A4_W - MARGIN * 2
  const h = 22
  doc.save()
  doc.roundedRect(x, y, w, h, 5).fillColor(COLORS.scoreBg).fill()
  const cy = y + h / 2
  // 左：练习名称
  const paper = String(meta?.paperName || '未命名试卷')
  const student = String(meta?.studentName || '').trim()
  const date = (meta?.printDate || new Date()).toISOString().slice(0, 10)
  doc.fillColor('#ffffff').font(F_BOLD).fontSize(9)
  // 左侧：练习名（截断 18 字）
  const paperTxt = paper.length > 18 ? paper.slice(0, 18) + '…' : paper
  doc.text(paperTxt, x + 8, cy - 4.5, { width: w * 0.42, align: 'left', lineBreak: false })
  // 中：谁得了几分
  const mid = `${student ? student + ' ' : ''}得分 ${pageGet}/${pageFull}（总 ${totalGet}/${totalFull}）`
  doc.font(F_REG).fontSize(8)
  doc.text(mid, x + w * 0.42, cy - 4, { width: w * 0.34, align: 'center', lineBreak: false })
  // 右：打印日期 + 页码
  const right = `${date} · 第${pageNo}/${totalPages}页`
  doc.text(right, x + w * 0.76, cy - 4, { width: w * 0.24 - 8, align: 'right', lineBreak: false })
  doc.restore()
}

/** 计算某页批注的绘图坐标（标记层与批注 PDF 共用，保证完全对齐） */
function annotationRect(rect: { x: number; y: number; w: number; h: number }, a: any) {
  const bx = rect.x + a.roiX * rect.w
  const by = rect.y + a.roiY * rect.h
  const bw = a.roiW * rect.w
  const bh = a.roiH * rect.h
  // v2：题级标记变小（不超过页宽 2.2%、不超过框高 55%、上限 16pt）
  const markSize = Math.min(bh * 0.55, MARK_SIZE_Q * rect.w, 16)
  const mx = bx + bw - markSize * 0.7
  const my = by + markSize * 0.6
  return { bx, by, bw, bh, markSize, mx, my }
}

/** 小号文本通用绘制（白色描边底避免压住笔迹） */
function smallText(
  doc: PDFDocument,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  color: string,
  bold = false
) {
  const fs_ = Math.max(6, Math.min(fontSize, 9))
  doc
    .fontSize(fs_)
    .fillColor(color)
    .font(bold ? F_BOLD : F_REG)
    .text(text, x, y + (h - fs_) / 2 - 0.5, {
      width: w,
      height: h,
      ellipsis: true,
      lineBreak: false,
      align: 'left',
    })
}

/**
 * 答案/错因/解析回填（v2，全部小字号，位置锁定不跑位）：
 *  - 有空白位置 → 答案写入空白处，错因/解析紧随其后
 *  - 没有位置 → 写在勾叉旁边
 */
function drawBackfill(
  doc: PDFDocument,
  rect: { x: number; y: number; w: number; h: number },
  a: any,
  layers: RenderLayers
) {
  if (!layers.answers && !layers.reason && !layers.solution) return
  const plan = computeBackfill({ ...a, judgeType: a.judgeType })
  // 一题多空：答案已写入每个空内（见 drawBlankMarks），跳过题级答案避免重复重叠
  const hasBlanks = parseBlanks(a.blanksJson).length > 0
  const toAbs = (b: { x: number; y: number; w: number; h: number }) => ({
    x: rect.x + b.x * rect.w,
    y: rect.y + b.y * rect.h,
    w: b.w * rect.w,
    h: b.h * rect.h,
  })

  if (layers.answers && plan.answer && !hasBlanks) {
    const b = toAbs(plan.answer)
    const beside = plan.answer.mode === 'beside-mark' || plan.answer.mode === 'inline'
    const cleaned = cleanAnswerText(a.answerText)
    const text = beside ? truncateForBeside(cleaned, 14) : truncateForBeside(cleaned, 24)
    if (text) {
      doc.save()
      doc.roundedRect(b.x - 2, b.y - 1, b.w + 4, b.h + 2, 3)
      doc.fillOpacity(0.12).fill('#16a34a')
      doc.restore()
      smallText(doc, `答：${text}`, b.x, b.y, b.w, b.h, beside ? 7 : 8, COLORS.answer, true)
    }
  }

  if (layers.reason && plan.reason) {
    const b = toAbs(plan.reason)
    const beside = plan.reason.mode === 'beside-mark' || plan.reason.mode === 'inline'
    const text = truncateForBeside(cleanReasonText(a.briefReason), beside ? 18 : 30)
    if (text) smallText(doc, `错因：${text}`, b.x, b.y, b.w, b.h, 6.5, COLORS.reason)
  }

  if (layers.solution && plan.solution) {
    const b = toAbs(plan.solution)
    const beside = plan.solution.mode === 'beside-mark' || plan.solution.mode === 'inline'
    const text = truncateForBeside(cleanSolutionText(a.fullSolution || a.briefReason), beside ? 18 : 34)
    if (text) smallText(doc, `析：${text}`, b.x, b.y, b.w, b.h, 6.5, COLORS.solution)
  }
}

/** 每空小标记（v2）：小 √×⍻ 贴空右侧 + 小得分 + 空内答案 */
function drawBlankMarks(
  doc: PDFDocument,
  rect: { x: number; y: number; w: number; h: number },
  a: any,
  layers: RenderLayers
) {
  if (!layers.marks) return
  const blanks = parseBlanks(a.blanksJson)
  if (blanks.length === 0) return
  const marks = computeBlankMarks(blanks)
  for (const m of marks) {
    const cx = rect.x + m.cx * rect.w
    const cy = rect.y + m.cy * rect.h
    const size = m.size * rect.w
    drawJudgeMark(doc, m.judge as JudgeType, cx, cy, size)
    // 小得分（标记右侧）
    if (layers.scores && m.scoreText) {
      doc
        .fontSize(Math.max(5.5, size * 0.5))
        .fillColor(COLORS.scoreBg)
        .font(F_BOLD)
        .text(m.scoreText, cx + size * 0.7, cy - size * 0.3, {
          width: size * 1.6,
          lineBreak: false,
        })
    }
    // 空内正确答案（错/半对的空，小字居中）
    if (layers.answers && m.answerText) {
      const bx = rect.x + m.box.x * rect.w
      const by = rect.y + m.box.y * rect.h
      const bw = m.box.w * rect.w
      const bh = m.box.h * rect.h
      doc
        .fontSize(Math.max(6, Math.min(bh * 0.7, 8)))
        .fillColor(COLORS.answer)
        .font(F_BOLD)
        .text(m.answerText, bx, by + bh / 2 - 4, {
          width: bw,
          align: 'center',
          lineBreak: false,
          ellipsis: true,
        })
    }
  }
}

/** 页级公共绘制（批注 PDF 与纯标记层共用） */
function drawPageAnnotations(
  doc: PDFDocument,
  rect: { x: number; y: number; w: number; h: number },
  list: any[],
  layers: RenderLayers,
  opts: { withBoxes: boolean; withBackfill: boolean }
) {
  for (const a of list) {
    const { bx, by, bw, bh, markSize, mx, my } = annotationRect(rect, a)

    if (opts.withBoxes && layers.boxes) {
      doc.save()
      doc.lineWidth(1)
      doc.strokeColor(COLORS.box)
      doc.roundedRect(bx, by, bw, bh, 4).stroke()
      doc.roundedRect(bx, by, bw, bh, 4)
      doc.fillOpacity(0.05).fill(COLORS.box)
      doc.restore()
    }

    // 题级判分符号（右上角内侧，v2 小号）
    if (layers.marks) {
      drawJudgeMark(doc, a.judgeType, mx, my, markSize)
    }

    // 每题得分（小字，框内右下角，不跑位）
    if (layers.scores) {
      const fs_ = 7
      doc
        .fontSize(fs_)
        .fillColor(COLORS.scoreBg)
        .font(F_BOLD)
        .text(`${a.getScore}/${a.fullScore}`, bx + 2, by + bh - fs_ - 1.5, {
          width: bw - 4,
          align: 'right',
          lineBreak: false,
        })
    }

    // 每空小标记
    drawBlankMarks(doc, rect, a, layers)

    // 答案/错因/解析回填
    if (opts.withBackfill) drawBackfill(doc, rect, a, layers)
  }
}

/** 页码集合与分数汇总（两个渲染器共用） */
function pageStats(input: RenderMarkInput, annotations: any[]) {
  const pageSet = new Set<number>(input.pageImages.keys())
  for (const a of annotations) pageSet.add(a.pageNo || 1)
  if (pageSet.size === 0) pageSet.add(1)
  const pageNos = Array.from(pageSet).sort((a, b) => a - b)
  const firstImg = Array.from(input.pageImages.values())[0]
  let totalGet = 0
  let totalFull = 0
  for (const a of annotations) {
    totalGet += a.getScore
    totalFull += a.fullScore
  }
  return { pageNos, firstImg, totalGet, totalFull }
}

/**
 * 渲染批注 PDF：逐页原图 + 题框 + √/×/半对 + 每空标记 + 宽分数条
 */
export async function renderMarkPdf(
  outPath: string,
  input: RenderMarkInput,
  annotations: any[]
): Promise<void> {
  const layers = normalizeLayers(input.layers)
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margin: 0 })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    const { pageNos, firstImg, totalGet, totalFull } = pageStats(input, annotations)

    pageNos.forEach((pageNo, idx) => {
      if (idx > 0) doc.addPage({ size: [A4_W, A4_H], margin: 0 })
      doc.rect(0, 0, A4_W, A4_H).fill('#ffffff')

      const pg = input.pageImages.get(pageNo) || firstImg
      const rect = pg ? fitRect(pg.w, pg.h) : fitRect(0, 0)

      if (pg && fs.existsSync(pg.path)) {
        try {
          doc.image(pg.path, rect.x, rect.y, { width: rect.w, height: rect.h })
        } catch {
          doc.rect(rect.x, rect.y, rect.w, rect.h).fill('#f3f4f6')
        }
      } else {
        doc.rect(rect.x, rect.y, rect.w, rect.h).fill('#f3f4f6')
      }

      const list = annotations.filter((a) => (a.pageNo || 1) === pageNo)
      let pageGetSum = 0
      let pageFullSum = 0
      for (const a of list) {
        pageGetSum += a.getScore
        pageFullSum += a.fullScore
      }
      if (layers.banner) {
        drawBanner(doc, input.meta, pageNo, pageNos.length, pageGetSum, pageFullSum, totalGet, totalFull)
      }

      drawPageAnnotations(doc, rect, list, layers, { withBoxes: true, withBackfill: true })
    })

    doc.end()
  })
}

/**
 * 渲染【纯标记层】PDF（可开答案/错因/解析，默认错因+答案开）：
 * - 透明背景（可叠加在原卷上打印）
 * - 只有标记类内容：判分符号 + 每空标记 + 得分 + 分数条 + （可选）回填文本
 */
export async function renderMarksOnlyPdf(
  outPath: string,
  input: RenderMarkInput,
  annotations: any[]
): Promise<void> {
  const layers = normalizeLayers(input.layers)
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margin: 0 })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    const { pageNos, firstImg, totalGet, totalFull } = pageStats(input, annotations)

    pageNos.forEach((pageNo, idx) => {
      if (idx > 0) doc.addPage({ size: [A4_W, A4_H], margin: 0 })
      // 不画白色背景 → 页面保持透明，打印时只有标记会落墨

      const pg = input.pageImages.get(pageNo) || firstImg
      const rect = pg ? fitRect(pg.w, pg.h) : fitRect(0, 0)

      const list = annotations.filter((a) => (a.pageNo || 1) === pageNo)
      let pageGetSum = 0
      let pageFullSum = 0
      for (const a of list) {
        pageGetSum += a.getScore
        pageFullSum += a.fullScore
      }
      if (layers.banner) {
        drawBanner(doc, input.meta, pageNo, pageNos.length, pageGetSum, pageFullSum, totalGet, totalFull)
      }

      // 纯标记层：无题框无原图；标记类内容（含回填文本）按图层开关绘制
      drawPageAnnotations(doc, rect, list, layers, { withBoxes: false, withBackfill: true })
    })

    doc.end()
  })
}

/**
 * 渲染答案汇总 PDF（独立答案页）
 */
export async function renderAnswerPdf(
  outPath: string,
  paperName: string,
  annotations: any[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margins: { top: 48, bottom: 48, left: 48, right: 48 } })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    doc.fillColor('#111827').fontSize(20).font(F_BOLD).text('答案汇总', { align: 'center' })
    doc.moveDown(0.4)
    doc.fontSize(12).font(F_REG).fillColor('#374151').text(paperName, { align: 'center' })
    doc.moveDown(1)

    const list = [...annotations].sort((a, b) => a.pageNo - b.pageNo)
    let y = doc.y
    list.forEach((a, i) => {
      if (y > A4_H - 90) {
        doc.addPage()
        y = 48
      }
      doc.font(F_BOLD).fontSize(12).fillColor('#111827').text(`${i + 1}. ${a.questionText}`, 48, y, { width: A4_W - 96 })
      y = doc.y + 2
      doc.font(F_REG).fontSize(11).fillColor('#059669').text(`标准答案：${cleanAnswerText(a.answerText) || '—'}`, 64, y, { width: A4_W - 112 })
      y = doc.y + 2
      doc.font(F_REG).fillColor('#6b7280').text(`满分 ${a.fullScore}`, 64, y, { width: A4_W - 112 })
      y = doc.y + 14
    })

    doc.end()
  })
}

/**
 * 渲染解析汇总 PDF
 */
export async function renderParsePdf(
  outPath: string,
  paperName: string,
  annotations: any[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margins: { top: 48, bottom: 48, left: 48, right: 48 } })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    doc.fillColor('#111827').fontSize(20).font(F_BOLD).text('解析汇总', { align: 'center' })
    doc.moveDown(0.4)
    doc.fontSize(12).font(F_REG).fillColor('#374151').text(paperName, { align: 'center' })
    doc.moveDown(1)

    const list = [...annotations].sort((a, b) => a.pageNo - b.pageNo)
    let y = doc.y
    list.forEach((a, i) => {
      if (y > A4_H - 120) {
        doc.addPage()
        y = 48
      }
      doc.font(F_BOLD).fontSize(12).fillColor('#111827').text(`${i + 1}. ${a.questionText}  (${a.getScore}/${a.fullScore})`, 48, y, { width: A4_W - 96 })
      y = doc.y + 2
      if (a.briefReason) {
        doc.font(F_REG).fontSize(10).fillColor('#b45309').text(`错在哪步：${cleanReasonText(a.briefReason)}`, 64, y, { width: A4_W - 112 })
        y = doc.y + 2
      }
      doc.font(F_REG).fontSize(11).fillColor('#1f2937').text(`解析：${cleanSolutionText(a.fullSolution) || '—'}`, 64, y, { width: A4_W - 112 })
      y = doc.y + 16
    })

    doc.end()
  })
}

/** 生成指定 task 的四类 PDF（批注/标记层/答案/解析），写回 files 表 */
export async function generateTaskPdfs(
  taskId: string,
  layerOverride?: any
): Promise<{
  mark: string
  marks: string
  answer: string
  parse: string
}> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { annotations: true, files: true },
  })
  if (!task) throw new Error('task not found')

  // 图层优先级：调用方显式传入 > 用户默认配置（configJson.layers）
  let layers = normalizeLayers(undefined)
  try {
    const user = await db.user.findUnique({ where: { id: task.userId } })
    layers = normalizeLayers(JSON.parse(user?.configJson || '{}').layers)
  } catch {}
  if (layerOverride) layers = normalizeLayers({ ...layers, ...layerOverride })

  // 按页组织原图
  const pageImages = new Map<number, PageImage>()
  for (const f of task.files) {
    if (f.fileType !== 'origin') continue
    const abs = absPath(f.filePath)
    if (!fs.existsSync(abs)) continue
    pageImages.set(f.pageNo || 1, {
      path: abs,
      w: f.width || task.imgWidth || 1000,
      h: f.height || task.imgHeight || 1414,
    })
  }
  if (pageImages.size === 0) throw new Error('origin image not found')

  const pdfRoot = pdfDir()

  const markPath = path.join(pdfRoot, `${taskId}-mark.pdf`)
  const marksPath = path.join(pdfRoot, `${taskId}-marks.pdf`)
  const answerPath = path.join(pdfRoot, `${taskId}-answer.pdf`)
  const parsePath = path.join(pdfRoot, `${taskId}-parse.pdf`)

  const meta = {
    paperName: task.paperName,
    studentName: task.studentName,
    printDate: new Date(),
  }
  const input: RenderMarkInput = {
    taskId,
    pageImages,
    annotations: task.annotations,
    meta,
    layers,
  }
  await renderMarkPdf(markPath, input, task.annotations)
  await renderMarksOnlyPdf(marksPath, input, task.annotations)
  await renderAnswerPdf(answerPath, task.paperName, task.annotations)
  await renderParsePdf(parsePath, task.paperName, task.annotations)

  // 记录到 files 表（upsert by task+type）
  async function upsertFile(fileType: string, absP: string) {
    const rel = relPath(absP)
    const existing = task.files.find((f) => f.fileType === fileType)
    if (existing) {
      await db.file.update({ where: { id: existing.id }, data: { filePath: rel } })
    } else {
      await db.file.create({ data: { taskId, fileType, filePath: rel } })
    }
  }
  await upsertFile('mark_pdf', markPath)
  await upsertFile('marks_pdf', marksPath)
  await upsertFile('answer_pdf', answerPath)
  await upsertFile('parse_pdf', parsePath)

  return { mark: markPath, marks: marksPath, answer: answerPath, parse: parsePath }
}

/**
 * 把一组图片渲染成 PDF（每页一张，快速复印用）
 */
export async function renderImagesPdf(outPath: string, images: PageImage[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margin: 0 })
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    images.forEach((img, idx) => {
      if (idx > 0) doc.addPage({ size: [A4_W, A4_H], margin: 0 })
      doc.rect(0, 0, A4_W, A4_H).fill('#ffffff')
      if (fs.existsSync(img.path)) {
        const rect = fitRect(img.w, img.h)
        try {
          doc.image(img.path, rect.x, rect.y, { width: rect.w, height: rect.h })
        } catch {
          doc.rect(rect.x, rect.y, rect.w, rect.h).fill('#f3f4f6')
        }
      }
    })

    doc.end()
  })
}
