/**
 * 答案/解析/错因回填布局算法 v2（共享）：
 * 复核界面（HTML 叠加层）、批注 PDF（pdfkit）、Brother 直连 JPEG（SVG）
 * 三端使用同一套摆放规则，保证所见即所得。
 *
 * v2 变更（用户需求）：
 *  - 标记变小：题级 √×⍻ 缩小；每空旁边打小标记（精确到空）
 *  - 答案/解析字变小，紧贴勾/叉旁边或正下方，绝不跑到别处
 *  - 错因（错在哪步）默认标注在标记旁边（小字灰/红）
 *  - 每空判分 blanks：小 √×⍻ + 小得分 + 空内答案
 *
 * 落位规则：
 *  - 题目有作答空白（answerRoi 在题区下半部）→ 答案写入空白处，解析紧随其后
 *  - 行内填空（answerRoi 在题干行）→ 答案写在行末空白（右对齐）
 *  - 无空白 → 答案填在勾/叉标记旁边（标记正下方）
 */

export interface BackfillAnn {
  roiX: number
  roiY: number
  roiW: number
  roiH: number
  answerRoiX?: number | null
  answerRoiY?: number | null
  answerRoiW?: number | null
  answerRoiH?: number | null
  answerText?: string | null
  fullSolution?: string | null
  briefReason?: string | null
  /** 判分类型：全对的题不回填（学生已写对，再写会与笔迹重叠） */
  judgeType?: string | null
}

/** 一题多空：单个空的信息 */
export interface BlankItem {
  roiX: number
  roiY: number
  roiW: number
  roiH: number
  judge: string
  getScore: number
  fullScore: number
  answerText?: string | null
}

export type BackfillMode = 'blank' | 'inline' | 'roi-bottom' | 'beside-mark'

export interface BackfillBox {
  /** 相对页面坐标 0~1 */
  x: number
  y: number
  w: number
  h: number
}

export interface BackfillPlan {
  answer: (BackfillBox & { mode: BackfillMode; label: string }) | null
  solution: (BackfillBox & { mode: BackfillMode }) | null
  /** 错因（错在哪步）：默认跟随标记旁/答案下方，小字 */
  reason: (BackfillBox & { mode: BackfillMode }) | null
}

/** 每空小标记（页面级相对坐标 + 尺寸比例） */
export interface BlankMark {
  /** 标记中心（相对页面 0~1） */
  cx: number
  cy: number
  /** 标记大小（相对页宽） */
  size: number
  judge: string
  /** 小得分文本（空有分值时） */
  scoreText: string | null
  /** 答错/半对时空内要填的正确答案 */
  answerText: string | null
  /** 答案写入的空内区域（居中） */
  box: BackfillBox
}

// ---------- 尺寸常量（相对页面比例，v2 全部调小） ----------
/** 题级标记最大边长（相对页宽） */
export const MARK_SIZE_Q = 0.022
/** 每空标记边长（相对页宽）—— 更小 */
export const MARK_SIZE_BLANK = 0.015
/** 答案文字行高（相对页高） */
const ANSWER_H = 0.024
/** 解析文字行高（相对页高） */
const SOLUTION_H = 0.018
/** 错因文字行高（相对页高） */
const REASON_H = 0.018
/** 行间距 */
const GAP = 0.004

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** 去掉 VLM 常带的「标准答案：」前缀 */
export function cleanAnswerText(t?: string | null): string {
  return String(t || '')
    .trim()
    .replace(/^标准答案[:：]?\s*/, '')
    .replace(/^答案[:：]?\s*/, '')
    .trim()
}

/** 去掉解析文本常带的「解析：」前缀 */
export function cleanSolutionText(t?: string | null): string {
  return String(t || '')
    .trim()
    .replace(/^解析[:：]?\s*/, '')
    .replace(/^[:：]\s*/, '')
    .trim()
}

/** 错因文本（错在哪步） */
export function cleanReasonText(t?: string | null): string {
  return String(t || '')
    .trim()
    .replace(/^错因[:：]?\s*/, '')
    .replace(/^扣分原因[:：]?\s*/, '')
    .replace(/^点评[:：]?\s*/, '')
    .trim()
}

/**
 * 计算某题的答案/解析/错因回填位置。
 * 全部返回相对页面坐标；调用方乘以页面宽高即得像素坐标。
 */
export function computeBackfill(a: BackfillAnn): BackfillPlan {
  const empty: BackfillPlan = { answer: null, solution: null, reason: null }
  // 全对的题不回填：学生已写对，再写答案只会与笔迹重叠
  if (a.judgeType === 'correct') return empty
  const answer = cleanAnswerText(a.answerText)
  const solution = cleanSolutionText(a.fullSolution)
  const reason = cleanReasonText(a.briefReason)
  if (!answer && !solution && !reason) return empty

  const roi = { x: a.roiX || 0, y: a.roiY || 0, w: a.roiW || 0, h: a.roiH || 0 }

  // ---------- 1) VLM 识别的作答空白区 ----------
  const ar = {
    x: a.answerRoiX,
    y: a.answerRoiY,
    w: a.answerRoiW,
    h: a.answerRoiH,
  }
  const arPresent =
    ar.x != null && ar.y != null && (ar.w || 0) >= 0.1 && (ar.h || 0) >= 0.016
  const arBelowQuestion = arPresent && ar.y! >= roi.y + roi.h * 0.4

  if (arPresent && arBelowQuestion) {
    // 1a) 真实作答空白区（位于题目区域下半部）：答案写入空白，解析/错因紧随其后
    const bx = clamp01(ar.x!)
    const by = clamp01(ar.y!)
    const bw = Math.min(clamp01(ar.w!), 1 - bx)
    const bh = Math.min(clamp01(ar.h!), 1 - by)
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: by, w: bw, h: Math.min(bh, ANSWER_H), mode: 'blank', label: '答' }
        : null,
      solution: null,
      reason: null,
    }
    // 逐行向下排：答案 → 错因 → 解析（各占一行小字，不跑位）
    let cy = by + (answer ? Math.min(bh, ANSWER_H) + GAP : 0)
    const maxW = bw
    if (reason && cy + REASON_H <= by + bh + 0.01) {
      plan.reason = { x: bx, y: cy, w: maxW, h: REASON_H, mode: 'blank' }
      cy += REASON_H + GAP
    }
    if (solution && cy + SOLUTION_H <= by + bh + 0.012) {
      plan.solution = { x: bx, y: cy, w: maxW, h: SOLUTION_H, mode: 'blank' }
    } else if (solution && answer && bw >= 0.45 && !plan.reason) {
      // 高度不够但横向富余 → 解析跟在答案右侧
      plan.solution = {
        x: bx + Math.min(bw * 0.42, 0.22),
        y: by,
        w: bw * 0.55,
        h: Math.min(bh, ANSWER_H),
        mode: 'blank',
      }
    }
    return plan
  }

  if (arPresent && answer) {
    // 1b) 行内填空（answerRoi 在题干行上）：答案写在行末空白之后（右对齐），不压题干
    const lineRight = clamp01(ar.x! + ar.w!)
    const boxW = Math.min(Math.max(clamp01(ar.w!) * 0.35, 0.14), 0.22)
    const bx = clamp01(lineRight - boxW)
    const by = clamp01(ar.y!)
    return {
      answer: {
        x: bx,
        y: by,
        w: Math.min(boxW, 1 - bx),
        h: Math.min(clamp01(ar.h!), ANSWER_H),
        mode: 'inline',
        label: '答',
      },
      // 行内填空不附解析/错因（交给独立解析页）
      solution: null,
      reason: null,
    }
  }

  // ---------- 2) ROI 内部下方有空间（题框较宽较高，底部 42% 是作答区） ----------
  const roiBottomH = roi.h * 0.42
  if (roi.w >= 0.25 && roiBottomH >= 0.028) {
    const bh = Math.min(roiBottomH, 0.055)
    const by = roi.y + roi.h - bh
    const bw = roi.w * 0.82
    const bx = roi.x + roi.w - bw
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: by, w: bw, h: Math.min(bh, ANSWER_H), mode: 'roi-bottom', label: '答' }
        : null,
      solution: null,
      reason: null,
    }
    let cy = by + (answer ? Math.min(bh, ANSWER_H) + GAP : 0)
    if (reason && cy + REASON_H <= by + bh + 0.008) {
      plan.reason = { x: bx, y: cy, w: bw, h: REASON_H, mode: 'roi-bottom' }
      cy += REASON_H + GAP
    }
    if (solution && cy + SOLUTION_H <= by + bh + 0.01) {
      plan.solution = { x: bx, y: cy, w: bw, h: SOLUTION_H, mode: 'roi-bottom' }
    }
    return plan
  }

  // ---------- 3) 没有位置 → 填在勾勾叉叉旁边（标记正下方，避开题干文字） ----------
  const besideW = Math.max(Math.min(roi.w * 0.62, 0.3), 0.18)
  const bx = clamp01(roi.x + roi.w - besideW - 0.01)
  // 标记在 ROI 右上角，答案放标记正下方（ROI 下边缘外侧），不压题干
  const by = clamp01(Math.min(roi.y + roi.h + 0.004, 1 - ANSWER_H - 0.004))
  const bw = Math.min(besideW, 1 - bx)
  const plan: BackfillPlan = {
    answer: answer
      ? { x: bx, y: by, w: bw, h: ANSWER_H, mode: 'beside-mark', label: '答' }
      : null,
    solution: null,
    reason: null,
  }
  // 错因跟在答案正下方（还是标记旁边区域，不会跑到别处）
  if (reason) {
    plan.reason = {
      x: bx,
      y: clamp01(by + ANSWER_H + GAP),
      w: bw,
      h: REASON_H,
      mode: 'beside-mark',
    }
  }
  return plan
}

/**
 * 每空小标记布局（v2）：
 * - 小 √×⍻ 打在空的右侧（贴着空的小空位）
 * - 空有分值时右侧再带小得分 "x/y"
 * - 答错/半对的空：正确答案以小字填在空内（居中）
 */
export function computeBlankMarks(blanks: BlankItem[]): BlankMark[] {
  const out: BlankMark[] = []
  for (const b of blanks) {
    const bw = b.roiW || 0
    const bh = b.roiH || 0
    if (bw <= 0 || bh <= 0) continue
    const size = Math.max(MARK_SIZE_BLANK, Math.min(bh * 0.9, 0.02))
    // 标记贴在空右侧
    const cx = clamp01(Math.min(b.roiX + bw + size * 0.7, 1 - size * 0.5))
    const cy = clamp01(b.roiY + bh / 2)
    const wrong = b.judge !== 'correct'
    out.push({
      cx,
      cy,
      size,
      judge: b.judge,
      scoreText: b.fullScore > 0 ? `${b.getScore}/${b.fullScore}` : null,
      // 空内答案只给错/半对的空；答案短才写进空里（长了写不下）
      answerText:
        wrong && b.answerText && cleanAnswerText(b.answerText).length <= 8
          ? cleanAnswerText(b.answerText)
          : null,
      box: {
        x: clamp01(b.roiX),
        y: clamp01(b.roiY),
        w: clamp01(bw),
        h: clamp01(bh),
      },
    })
  }
  return out
}

/** beside 模式下的短文案截断（渲染端调用） */
export function truncateForBeside(text: string, max = 16): string {
  const t = String(text || '').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 解析安全 JSON 解析 blanks（容错） */
export function parseBlanks(json?: string | null): BlankItem[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((b: any) => b && b.roi && Number(b.roi.w) > 0 && Number(b.roi.h) > 0)
      .map((b: any) => ({
        roiX: clamp01(Number(b.roi.x) || 0),
        roiY: clamp01(Number(b.roi.y) || 0),
        roiW: clamp01(Number(b.roi.w) || 0),
        roiH: clamp01(Number(b.roi.h) || 0),
        judge: String(b.judge || 'wrong'),
        getScore: Number(b.getScore) || 0,
        fullScore: Number(b.fullScore) || 0,
        answerText: b.answerText ?? null,
      }))
  } catch {
    return []
  }
}
