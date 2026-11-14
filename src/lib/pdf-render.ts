import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { db } from './db'
import { pdfDir, relPath, absPath } from './storage'

export type JudgeType = 'correct' | 'wrong' | 'partial'

export interface PageImage {
  path: string
  w: number
  h: number
}

export interface RenderMarkInput {
  taskId: string
  pageImages: Map<number, PageImage> // pageNo → 图片
  annotations: any[]
}

const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 24

const COLORS = {
  correct: '#16a34a', // green
  wrong: '#dc2626', // red
  partial: '#d97706', // amber
  box: '#2563eb',
  scoreBg: '#1f2937',
  scoreText: '#ffffff',
}

// ---------- 中文字体（解决导出乱码） ----------
// 优先使用项目内嵌字体，回退系统字体目录
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

/** 字体名：有中文字体用 cjk，否则退回 Helvetica（仅英文数字可正常显示） */
const F_REG = CJK_REG_PATH ? 'cjk' : 'Helvetica'
const F_BOLD = CJK_BOLD_PATH ? 'cjk-bold' : 'Helvetica-Bold'

/** 每个文档创建后注册中文字体（pdfkit 自动子集化，仅嵌入用到的字形） */
function registerCjk(doc: PDFDocument) {
  if (CJK_REG_PATH) doc.registerFont('cjk', CJK_REG_PATH)
  if (CJK_BOLD_PATH) doc.registerFont('cjk-bold', CJK_BOLD_PATH)
}

/** 把图片等比缩放铺到 A4 页面可用区域，返回绘图矩形 */
function fitRect(imgW: number, imgH: number) {
  const availW = A4_W - MARGIN * 2
  const availH = A4_H - MARGIN * 2 - 28 // 顶部留分数栏
  if (!imgW || !imgH) {
    return { x: MARGIN, y: MARGIN + 28, w: availW, h: availH }
  }
  const scale = Math.min(availW / imgW, availH / imgH)
  const w = imgW * scale
  const h = imgH * scale
  const x = MARGIN + (availW - w) / 2
  const y = MARGIN + 28 + (availH - h) / 2
  return { x, y, w, h }
}

/** 绘制 √ 勾（绿色） */
function drawCheck(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  doc.save()
  doc.lineWidth(size * 0.14)
  doc.strokeColor(color)
  doc.moveTo(cx - size * 0.4, cy)
  doc.lineTo(cx - size * 0.08, cy + size * 0.32)
  doc.lineTo(cx + size * 0.42, cy - size * 0.34)
  doc.stroke()
  doc.restore()
}

/** 绘制 × 叉（红色） */
function drawCross(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  doc.save()
  doc.lineWidth(size * 0.14)
  doc.strokeColor(color)
  doc.moveTo(cx - size * 0.35, cy - size * 0.35)
  doc.lineTo(cx + size * 0.35, cy + size * 0.35)
  doc.moveTo(cx + size * 0.35, cy - size * 0.35)
  doc.lineTo(cx - size * 0.35, cy + size * 0.35)
  doc.stroke()
  doc.restore()
}

/**
 * 绘制半对标记：一个完整的勾，勾的上方再打一个叉（琥珀色）
 * 勾照常画，叉覆盖在勾的上半部区域
 */
function drawHalfCheck(doc: PDFDocument, cx: number, cy: number, size: number, color: string) {
  // 1. 完整的勾
  drawCheck(doc, cx, cy, size, color)
  // 2. 勾上方打一个叉（中心位于勾的上部，半径 0.20*size）
  doc.save()
  doc.lineWidth(size * 0.11)
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

function drawScoreTag(
  doc: PDFDocument,
  pageNo: number,
  pageGet: number,
  pageFull: number,
  totalGet: number,
  totalFull: number
) {
  const label = `第 ${pageNo} 页  ${pageGet} / ${pageFull}    总分 ${totalGet} / ${totalFull}`
  const w = 230
  const h = 22
  const x = A4_W - MARGIN - w
  const y = MARGIN
  doc.save()
  doc.roundedRect(x, y, w, h, 6).fillColor(COLORS.scoreBg).fill()
  doc
    .fillColor(COLORS.scoreText)
    .fontSize(11)
    .font(F_BOLD)
    .text(label, x + 8, y + 6, { width: w - 16, align: 'right' })
  doc.restore()
}

/** 计算某页批注的绘图坐标（标记层与批注 PDF 共用，保证完全对齐） */
function annotationRect(rect: { x: number; y: number; w: number; h: number }, a: any) {
  const bx = rect.x + a.roiX * rect.w
  const by = rect.y + a.roiY * rect.h
  const bw = a.roiW * rect.w
  const bh = a.roiH * rect.h
  const markSize = Math.min(bh, 28)
  const mx = bx + bw - markSize * 0.7
  const my = by + markSize * 0.6
  return { bx, by, bw, bh, markSize, mx, my }
}

/**
 * 渲染批注 PDF：逐页原图 + 题框 + √/×/半对 + 右上角分数
 */
export async function renderMarkPdf(
  outPath: string,
  input: RenderMarkInput,
  annotations: any[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margin: 0 })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

    // 页集合 = 图片页 ∪ 批注页
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

    pageNos.forEach((pageNo, idx) => {
      if (idx > 0) doc.addPage({ size: [A4_W, A4_H], margin: 0 })
      // 背景白
      doc.rect(0, 0, A4_W, A4_H).fill('#ffffff')

      // 当前页图片（无则用第一张兜底）
      const pg = input.pageImages.get(pageNo) || firstImg
      const rect = pg ? fitRect(pg.w, pg.h) : fitRect(0, 0)

      // 图片
      if (pg && fs.existsSync(pg.path)) {
        try {
          doc.image(pg.path, rect.x, rect.y, { width: rect.w, height: rect.h })
        } catch {
          doc.rect(rect.x, rect.y, rect.w, rect.h).fill('#f3f4f6')
        }
      } else {
        doc.rect(rect.x, rect.y, rect.w, rect.h).fill('#f3f4f6')
      }

      // 页面分数汇总
      const list = annotations.filter((a) => (a.pageNo || 1) === pageNo)
      let pageGetSum = 0
      let pageFullSum = 0
      for (const a of list) {
        pageGetSum += a.getScore
        pageFullSum += a.fullScore
      }
      drawScoreTag(doc, pageNo, pageGetSum, pageFullSum, totalGet, totalFull)

      // 每题框 + 判分符号
      for (const a of list) {
        const { bx, by, bw, bh, markSize, mx, my } = annotationRect(rect, a)

        doc.save()
        doc.lineWidth(1.2)
        doc.strokeColor(COLORS.box)
        doc.roundedRect(bx, by, bw, bh, 4).stroke()
        // 浅填充
        doc.roundedRect(bx, by, bw, bh, 4)
        doc.fillOpacity(0.06).fill(COLORS.box)
        doc.restore()

        // 判分符号绘制在框右上角内侧
        drawJudgeMark(doc, a.judgeType, mx, my, markSize)

        // 得分标注
        doc
          .fontSize(9)
          .fillColor(COLORS.scoreBg)
          .font(F_BOLD)
          .text(`${a.getScore}/${a.fullScore}`, bx + 4, by + bh + 2, {
            width: bw - 8,
            align: 'right',
          })
      }
    })

    doc.end()
  })
}

/**
 * 渲染【纯标记层】PDF：
 * - 透明背景（可叠加在原卷上打印）
 * - 不含原图、不含题框、不含题目文字
 * - 只有：判分符号（√ / × / 勾上叉）+ 每题得分 + 右上角分数
 * - 坐标与批注 PDF 完全一致，叠加打印可对位
 */
export async function renderMarksOnlyPdf(
  outPath: string,
  input: RenderMarkInput,
  annotations: any[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [A4_W, A4_H], margin: 0 })
    registerCjk(doc)
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)
    stream.on('finish', resolve)
    stream.on('error', reject)

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

    pageNos.forEach((pageNo, idx) => {
      if (idx > 0) doc.addPage({ size: [A4_W, A4_H], margin: 0 })
      // 注意：不画白色背景 → 页面保持透明，打印时只有标记会落墨

      const pg = input.pageImages.get(pageNo) || firstImg
      const rect = pg ? fitRect(pg.w, pg.h) : fitRect(0, 0)

      // 右上角分数（属于批改标记）
      const list = annotations.filter((a) => (a.pageNo || 1) === pageNo)
      let pageGetSum = 0
      let pageFullSum = 0
      for (const a of list) {
        pageGetSum += a.getScore
        pageFullSum += a.fullScore
      }
      drawScoreTag(doc, pageNo, pageGetSum, pageFullSum, totalGet, totalFull)

      // 只画判分符号 + 得分数字（无题框、无图片、无题目）
      for (const a of list) {
        const { bx, by, bw, bh, markSize, mx, my } = annotationRect(rect, a)
        drawJudgeMark(doc, a.judgeType, mx, my, markSize)
        doc
          .fontSize(9)
          .fillColor(COLORS.scoreBg)
          .font(F_BOLD)
          .text(`${a.getScore}/${a.fullScore}`, bx + 4, by + bh + 2, {
            width: bw - 8,
            align: 'right',
          })
      }
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
      doc.font(F_REG).fontSize(11).fillColor('#059669').text(`标准答案：${a.answerText || '—'}`, 64, y, { width: A4_W - 112 })
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
        doc.font(F_REG).fontSize(10).fillColor('#b45309').text(`点评：${a.briefReason}`, 64, y, { width: A4_W - 112 })
        y = doc.y + 2
      }
      doc.font(F_REG).fontSize(11).fillColor('#1f2937').text(`解析：${a.fullSolution || '—'}`, 64, y, { width: A4_W - 112 })
      y = doc.y + 16
    })

    doc.end()
  })
}

/** 生成指定 task 的四类 PDF（批注/标记层/答案/解析），写回 files 表 */
export async function generateTaskPdfs(taskId: string): Promise<{
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

  const input: RenderMarkInput = { taskId, pageImages, annotations: task.annotations }
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
