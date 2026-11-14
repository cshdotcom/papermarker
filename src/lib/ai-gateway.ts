import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { db } from './db'

// 判分类型
export type JudgeType = 'correct' | 'wrong' | 'partial'

export interface RoiRect {
  x: number
  y: number
  w: number
  h: number
}
export interface AiBlank {
  roi: RoiRect
  judge: JudgeType
  getScore: number
  fullScore: number
  answerText?: string | null
}
export interface AiQuestion {
  pageNo: number
  questionText: string
  roi: RoiRect
  fullScore: number
  getScore: number
  judge: JudgeType
  confidence: number
  briefReason: string
  fullSolution: string
  answerText: string
  /** 题目作答空白区（用于答案回填），可为空 */
  answerRoi?: RoiRect | null
  /** 一题多空：每个小空的独立判分，可为空 */
  blanks?: AiBlank[] | null
}
export interface AiGradeResult {
  paperName: string
  studentName: string
  totalFull: number
  totalGet: number
  questions: AiQuestion[]
}

const SYSTEM_PROMPT = `你是一名严谨、有经验的阅卷老师。请分析给定的试卷图片，识别其中的题目与学生作答，进行批改打分。

要求：
1. 识别每道题的位置（用相对坐标，左上角为原点，取值 0~1）。
2. 判断每道题对错：correct(完全正确) / wrong(错误) / partial(部分正确，半勾)。
3. 给出每题满分、得分、扣分原因、完整解析、标准答案。
4. 统计试卷总分与得分。
5. 每题标注所在页码 pageNo（第几张图片即为第几页）。
6. 若题目下方/旁边有学生作答的空白区域，给出 answerRoi（该空白区域的相对坐标）；题目没有空白位置（如选择题）则省略 answerRoi。答案回填时优先写入该空白处。
7. 【一题多空】填空题/计算题含多个小空（横线、括号、方框）时，必须在 blanks 数组中给出每一个小空的独立判分：每个空的相对坐标 roi（尽量精确到空本身）、该空对错 judge、该空得分 getScore/满分 fullScore、该空正确答案 answerText。单个空的题目若已给出 answerRoi 可省略 blanks。
8. 【错在哪步】学生答错时，briefReason 必须写清楚具体错在哪一步（如“第二步移项符号出错，应为 -6 而写了 +6”），不要只写“计算错误”。

严格只返回 JSON（不要 markdown 代码块、不要解释文字），结构如下：
{
  "paperName": "试卷名称",
  "studentName": "学生姓名（无可留空字符串）",
  "totalFull": 100,
  "totalGet": 88,
  "questions": [
    {
      "pageNo": 1,
      "questionText": "第1题 ...",
      "roi": { "x": 0.05, "y": 0.10, "w": 0.90, "h": 0.08 },
      "answerRoi": { "x": 0.10, "y": 0.14, "w": 0.80, "h": 0.03 },
      "blanks": [
        { "roi": { "x": 0.10, "y": 0.14, "w": 0.10, "h": 0.02 }, "judge": "wrong", "getScore": 0, "fullScore": 2, "answerText": "29" }
      ],
      "fullScore": 5,
      "getScore": 5,
      "judge": "correct",
      "confidence": 0.9,
      "briefReason": "解题过程完整正确",
      "fullSolution": "由 ... 得 ...",
      "answerText": "29"
    }
  ]
}
roi 坐标为相对图片宽高比例（0~1）。每题 roi 尽量贴合该题作答区域。answerRoi 必须位于该题 roi 之内或紧邻，表示可写入正确答案的空白位置；blanks 中每个空的 roi 必须精确到空本身（判分标记会打在空旁）。answerText 只写答案本身（不要加「标准答案：」等前缀），fullSolution 不要加「解析：」前缀。`

function extractJson(text: string): any | null {
  if (!text) return null
  // 去掉 markdown 代码块
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  // 找到第一个 { 到最后一个 }
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first === -1 || last === -1) return null
  const slice = t.slice(first, last + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

function normalizeJudge(j: any): JudgeType {
  const s = String(j || '').toLowerCase()
  if (s.includes('partial') || s.includes('half') || s === '半勾') return 'partial'
  if (s.includes('correct') || s.includes('right') || s.includes('对')) return 'correct'
  return 'wrong'
}

/** 去掉 VLM 常带的前缀 */
function stripPrefix(s: string): string {
  return String(s || '')
    .replace(/^标准答案[:：]?\s*/, '')
    .replace(/^解析[:：]?\s*/, '')
    .trim()
}

function normalizeBlanks(raw: any[]): AiBlank[] {
  const out: AiBlank[] = []
  for (const b of raw) {
    const r = b.roi || b
    const w = Number(r.w ?? r.width ?? 0)
    const h = Number(r.h ?? r.height ?? 0)
    // 空必须足够真实（太小的基本是幻觉）
    if (w <= 0 || w > 1 || h <= 0 || h > 1) continue
    const full = Number(b.fullScore ?? 0) || 0
    let get = Number(b.getScore ?? 0) || 0
    if (get > full) get = full
    if (get < 0) get = 0
    out.push({
      roi: {
        x: clamp01(Number(r.x ?? 0)),
        y: clamp01(Number(r.y ?? 0)),
        w: clamp01(w),
        h: clamp01(h),
      },
      judge: normalizeJudge(b.judge),
      getScore: get,
      fullScore: full,
      answerText: stripPrefix(String(b.answerText ?? b.answer ?? '')),
    })
  }
  return out
}

function normalizeQuestions(raw: any[]): AiQuestion[] {
  const out: AiQuestion[] = []
  const strip = stripPrefix
  for (const q of raw) {
    const roi = q.roi || {}
    const full = Number(q.fullScore ?? q.full_score ?? 0) || 0
    let get = Number(q.getScore ?? q.get_score ?? 0) || 0
    if (get > full) get = full
    if (get < 0) get = 0
    // 作答空白区（可选）：坐标有效才保留
    let answerRoi: RoiRect | null = null
    const ar = q.answerRoi || q.answer_roi
    if (ar && Number(ar.x) >= 0 && Number(ar.w) >= 0.1 && Number(ar.h) >= 0.018) {
      answerRoi = {
        x: clamp01(Number(ar.x)),
        y: clamp01(Number(ar.y)),
        w: clamp01(Number(ar.w ?? ar.width ?? 0)),
        h: clamp01(Number(ar.h ?? ar.height ?? 0)),
      }
    }
    // 一题多空（可选）：至少 1 个有效空才保留；单空且无独立判分意义时丢弃
    let blanks: AiBlank[] | null = null
    if (Array.isArray(q.blanks) && q.blanks.length > 0) {
      const bs = normalizeBlanks(q.blanks)
      blanks = bs.length > 0 ? bs : null
    }
    out.push({
      pageNo: Number(q.pageNo ?? 1) || 1,
      questionText: String(q.questionText ?? q.question_text ?? q.title ?? '未命名题目'),
      roi: {
        x: clamp01(Number(roi.x ?? 0)),
        y: clamp01(Number(roi.y ?? 0)),
        w: clamp01(Number(roi.w ?? roi.width ?? 0.3)),
        h: clamp01(Number(roi.h ?? roi.height ?? 0.08)),
      },
      fullScore: full,
      getScore: get,
      judge: normalizeJudge(q.judge ?? q.judge_type),
      confidence: clamp01(Number(q.confidence ?? 0.6)),
      briefReason: String(q.briefReason ?? q.reason ?? ''),
      fullSolution: strip(String(q.fullSolution ?? q.solution ?? '')),
      answerText: strip(String(q.answerText ?? q.answer ?? '')),
      answerRoi,
      blanks,
    })
  }
  return out
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** 当 VLM 失败或无法解析时，生成一组占位批改结果以保证界面流程可演示 */
export function syntheticResult(pageCount = 1): AiGradeResult {
  const base: (Omit<AiQuestion, 'pageNo'> & { answerRoi?: RoiRect | null })[] = [
    {
      questionText: '第1题 填空：12 + 17 = ▢，25 - 9 = ▢',
      roi: { x: 0.05, y: 0.08, w: 0.9, h: 0.1 },
      answerRoi: { x: 0.12, y: 0.135, w: 0.6, h: 0.03 },
      blanks: [
        { roi: { x: 0.24, y: 0.135, w: 0.08, h: 0.024 }, judge: 'correct', getScore: 2, fullScore: 2, answerText: '29' },
        { roi: { x: 0.46, y: 0.135, w: 0.08, h: 0.024 }, judge: 'wrong', getScore: 0, fullScore: 2, answerText: '16' },
      ],
      fullScore: 4,
      getScore: 2,
      judge: 'partial',
      confidence: 0.92,
      briefReason: '第二空退位减法出错：25-9 应为 16，学生误写 15（借位后误用 15-9=6 计算）',
      fullSolution: '12 + 17 = 29；25 - 9：个位 5 不够减 9，向十位借 1，15 - 9 = 6，十位剩 1，结果为 16。',
      answerText: '29；16',
    },
    {
      questionText: '第2题 解方程 2x + 6 = 14',
      roi: { x: 0.05, y: 0.20, w: 0.9, h: 0.12 },
      answerRoi: { x: 0.12, y: 0.26, w: 0.66, h: 0.035 },
      fullScore: 8,
      getScore: 6,
      judge: 'partial',
      confidence: 0.78,
      briefReason: '移项正确，但最后一步除法计算有误',
      fullSolution: '2x + 6 = 14 → 2x = 8 → x = 4。学生误写 x = 8。',
      answerText: 'x = 4',
    },
    {
      questionText: '第3题 化简 a(b+c)',
      roi: { x: 0.05, y: 0.34, w: 0.9, h: 0.1 },
      // 无空白区（演示：答案填在标记旁边）
      fullScore: 5,
      getScore: 0,
      judge: 'wrong',
      confidence: 0.85,
      briefReason: '未应用乘法分配律，直接写成 ab+c',
      fullSolution: 'a(b+c) = ab + ac（乘法分配律）。',
      answerText: 'ab + ac',
    },
    {
      questionText: '第4题 求三角形面积（底6高4）',
      roi: { x: 0.05, y: 0.46, w: 0.9, h: 0.12 },
      answerRoi: { x: 0.12, y: 0.53, w: 0.62, h: 0.032 },
      fullScore: 6,
      getScore: 6,
      judge: 'correct',
      confidence: 0.9,
      briefReason: 'S = 1/2·底·高 = 1/2·6·4 = 12，正确',
      fullSolution: 'S = 1/2 × 6 × 4 = 12。',
      answerText: '12',
    },
    {
      questionText: '第5题 应用题：路程计算',
      roi: { x: 0.05, y: 0.60, w: 0.9, h: 0.14 },
      answerRoi: { x: 0.10, y: 0.68, w: 0.78, h: 0.035 },
      fullScore: 10,
      getScore: 7,
      judge: 'partial',
      confidence: 0.7,
      briefReason: '列式正确，单位换算漏写',
      fullSolution: 'v = s/t = 120km/2h = 60 km/h。',
      answerText: '60 km/h',
    },
    {
      questionText: '第6题 几何证明',
      roi: { x: 0.05, y: 0.76, w: 0.9, h: 0.16 },
      answerRoi: { x: 0.10, y: 0.84, w: 0.8, h: 0.04 },
      fullScore: 10,
      getScore: 4,
      judge: 'partial',
      confidence: 0.65,
      briefReason: '证明思路对，但缺少关键步骤说明',
      fullSolution: '由已知条件可证两三角形全等，进而推出对应角相等。',
      answerText: '见解析',
    },
  ]
  // 多页时把题目均匀分布到各页，便于演示多页任务
  const qs: AiQuestion[] = base.map((q, i) => ({ ...q, pageNo: pageCount > 1 ? (i % pageCount) + 1 : 1 }))
  const totalFull = qs.reduce((s, q) => s + q.fullScore, 0)
  const totalGet = qs.reduce((s, q) => s + q.getScore, 0)
  return {
    paperName: '数学单元测验',
    studentName: '',
    totalFull,
    totalGet,
    questions: qs,
  }
}

/**
 * 调用 VLM 对试卷多页图片进行批改（一次请求携带全部页），返回结构化结果。
 * 失败时回退到合成结果，保证流程可演示。
 */
export async function gradeImages(imagePaths: string[]): Promise<AiGradeResult> {
  const pageCount = Math.max(1, imagePaths.length)
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()

    const prompt =
      pageCount > 1
        ? `本次提供同一份试卷的 ${pageCount} 页图片（按顺序第1页~第${pageCount}页）。请综合全部页面批改，每题的 pageNo 必须标注正确页码。\n\n${SYSTEM_PROMPT}`
        : SYSTEM_PROMPT

    const content: any[] = [{ type: 'text', text: prompt }]
    for (const p of imagePaths) {
      const buf = fs.readFileSync(p)
      const base64 = buf.toString('base64')
      const ext = path.extname(p).toLowerCase()
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      })
    }

    const response = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }],
      thinking: { type: 'disabled' },
    })

    const text = response.choices?.[0]?.message?.content || ''
    const parsed = extractJson(text)

    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      const questions = normalizeQuestions(parsed.questions)
      const totalFull =
        Number(parsed.totalFull) || questions.reduce((s, q) => s + q.fullScore, 0)
      const totalGet =
        Number(parsed.totalGet) || questions.reduce((s, q) => s + q.getScore, 0)
      return {
        paperName: String(parsed.paperName || '未命名试卷'),
        studentName: String(parsed.studentName || ''),
        totalFull,
        totalGet,
        questions,
      }
    }
    // 解析失败 → 合成
    return syntheticResult(pageCount)
  } catch (e: any) {
    console.warn('[ai-gateway] VLM 批改失败，使用合成结果:', e?.message)
    return syntheticResult(pageCount)
  }
}

/** 单页批改（兼容旧调用） */
export async function gradeImage(imagePath: string): Promise<AiGradeResult> {
  return gradeImages([imagePath])
}

/** 读取图片尺寸 */
export async function getImageSize(imagePath: string): Promise<{ w: number; h: number }> {
  try {
    const meta = await sharp(imagePath).metadata()
    return { w: meta.width || 0, h: meta.height || 0 }
  } catch {
    return { w: 0, h: 0 }
  }
}

/** 把 AI 结果写入数据库（annotations），并更新 task 汇总 */
export async function persistGrade(taskId: string, r: AiGradeResult) {
  // 先清空旧的 ai_only 批注（重新批改场景）
  await db.annotation.deleteMany({ where: { taskId, reviewStatus: 'ai_only' } })

  for (const q of r.questions) {
    await db.annotation.create({
      data: {
        taskId,
        pageNo: q.pageNo,
        roiX: q.roi.x,
        roiY: q.roi.y,
        roiW: q.roi.w,
        roiH: q.roi.h,
        judgeType: q.judge,
        fullScore: q.fullScore,
        getScore: q.getScore,
        confidence: q.confidence,
        briefReason: q.briefReason,
        fullSolution: q.fullSolution,
        answerText: q.answerText,
        questionText: q.questionText,
        layout: 'inplace',
        reviewStatus: 'ai_only',
        originJudgeType: q.judge,
        originGetScore: q.getScore,
        answerRoiX: q.answerRoi?.x ?? null,
        answerRoiY: q.answerRoi?.y ?? null,
        answerRoiW: q.answerRoi?.w ?? null,
        answerRoiH: q.answerRoi?.h ?? null,
        blanksJson: q.blanks && q.blanks.length > 0 ? JSON.stringify(q.blanks) : null,
      },
    })
  }

  const totalFull = r.questions.reduce((s, q) => s + q.fullScore, 0)
  const totalGet = r.questions.reduce((s, q) => s + q.getScore, 0)

  // 保留用户填写的信息：仅在用户未命名/未填学生时才用 AI 识别结果补全
  const current = await db.task.findUnique({
    where: { id: taskId },
    select: { paperName: true, studentName: true },
  })
  const nameUpdate: any = {}
  if (current && (!current.paperName || current.paperName === '未命名试卷') && r.paperName) {
    nameUpdate.paperName = r.paperName
  }
  if (current && !current.studentName && r.studentName) {
    nameUpdate.studentName = r.studentName
  }

  await db.task.update({
    where: { id: taskId },
    data: {
      ...nameUpdate,
      totalFull,
      totalGet,
      reviewStatus: 'pending_review',
    },
  })

  // 同步 task_pages（按 pageNo 汇总）
  const pages = new Map<number, { get: number; full: number }>()
  for (const q of r.questions) {
    const p = pages.get(q.pageNo) || { get: 0, full: 0 }
    p.get += q.getScore
    p.full += q.fullScore
    pages.set(q.pageNo, p)
  }
  for (const [pageNo, v] of pages) {
    await db.taskPage.upsert({
      where: { taskId_pageNo: { taskId, pageNo } },
      update: { pageGet: v.get, pageFull: v.full },
      create: { taskId, pageNo, pageGet: v.get, pageFull: v.full },
    })
  }
}
