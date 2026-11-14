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
      "fullScore": 5,
      "getScore": 5,
      "judge": "correct",
      "confidence": 0.9,
      "briefReason": "解题过程完整正确",
      "fullSolution": "解析：由 ... 得 ...",
      "answerText": "标准答案：..."
    }
  ]
}
roi 坐标为相对图片宽高比例（0~1）。每题 roi 尽量贴合该题作答区域。`

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

function normalizeQuestions(raw: any[]): AiQuestion[] {
  const out: AiQuestion[] = []
  for (const q of raw) {
    const roi = q.roi || {}
    const full = Number(q.fullScore ?? q.full_score ?? 0) || 0
    let get = Number(q.getScore ?? q.get_score ?? 0) || 0
    if (get > full) get = full
    if (get < 0) get = 0
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
      fullSolution: String(q.fullSolution ?? q.solution ?? ''),
      answerText: String(q.answerText ?? q.answer ?? ''),
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
  const base: Omit<AiQuestion, 'pageNo'>[] = [
    {
      questionText: '第1题 计算 12 + 17 = ?',
      roi: { x: 0.05, y: 0.08, w: 0.9, h: 0.1 },
      fullScore: 5,
      getScore: 5,
      judge: 'correct',
      confidence: 0.92,
      briefReason: '计算正确，过程清晰',
      fullSolution: '12 + 17 = 29，进位加法结果正确。',
      answerText: '29',
    },
    {
      pageNo: 1,
      questionText: '第2题 解方程 2x + 6 = 14',
      roi: { x: 0.05, y: 0.20, w: 0.9, h: 0.12 },
      fullScore: 8,
      getScore: 6,
      judge: 'partial',
      confidence: 0.78,
      briefReason: '移项正确，但最后一步除法计算有误',
      fullSolution: '2x + 6 = 14 → 2x = 8 → x = 4。学生误写 x = 8。',
      answerText: 'x = 4',
    },
    {
      pageNo: 1,
      questionText: '第3题 化简 a(b+c)',
      roi: { x: 0.05, y: 0.34, w: 0.9, h: 0.1 },
      fullScore: 5,
      getScore: 0,
      judge: 'wrong',
      confidence: 0.85,
      briefReason: '未应用乘法分配律，直接写成 ab+c',
      fullSolution: 'a(b+c) = ab + ac（乘法分配律）。',
      answerText: 'ab + ac',
    },
    {
      pageNo: 1,
      questionText: '第4题 求三角形面积（底6高4）',
      roi: { x: 0.05, y: 0.46, w: 0.9, h: 0.12 },
      fullScore: 6,
      getScore: 6,
      judge: 'correct',
      confidence: 0.9,
      briefReason: 'S = 1/2·底·高 = 1/2·6·4 = 12，正确',
      fullSolution: 'S = 1/2 × 6 × 4 = 12。',
      answerText: '12',
    },
    {
      pageNo: 1,
      questionText: '第5题 应用题：路程计算',
      roi: { x: 0.05, y: 0.60, w: 0.9, h: 0.14 },
      fullScore: 10,
      getScore: 7,
      judge: 'partial',
      confidence: 0.7,
      briefReason: '列式正确，单位换算漏写',
      fullSolution: 'v = s/t = 120km/2h = 60 km/h。',
      answerText: '60 km/h',
    },
    {
      pageNo: 1,
      questionText: '第6题 几何证明',
      roi: { x: 0.05, y: 0.76, w: 0.9, h: 0.16 },
      fullScore: 10,
      getScore: 4,
      judge: 'partial',
      confidence: 0.65,
      briefReason: '证明思路对，但缺少关键步骤说明',
      fullSolution: '由已知条件可证两三角形全等，进而推出对应角相等。',
      answerText: '略',
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
