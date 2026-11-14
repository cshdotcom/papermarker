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
  /** 同页下一题 ROI 顶部（相对页面 0~1）；限制下方回填不压到下一题文字 */
  nextTopY?: number | null
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

export type BackfillMode = 'blank' | 'inline' | 'below' | 'above' | 'beside-mark'

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

// ---------- 尺寸常量（相对页面比例，v3 更小更安全） ----------
/** 题级标记最大边长（相对页宽） */
export const MARK_SIZE_Q = 0.02
/** 每空标记边长（相对页宽）—— 更小 */
export const MARK_SIZE_BLANK = 0.014
/** 答案文字行高（相对页高） */
const ANSWER_H = 0.021
/** 解析文字行高（相对页高） */
const SOLUTION_H = 0.017
/** 错因文字行高（相对页高） */
const REASON_H = 0.017
/** 行间距 */
const GAP = 0.003

/**
 * 题级判分标记位置（v3）：题目旁边 —— 题号旁。
 * 优先放在 ROI 左侧页边（跟题号并排，老师批改习惯位）；
 * 左边距不够时落在 ROI 左上角内侧（仍紧挨题号，不跑到右边）。
 * 返回相对页面 0~1 的标记中心与大小。
 */
export function questionMarkPos(
  roi: { x: number; y: number; w: number; h: number },
  sizeHint = MARK_SIZE_Q
): { cx: number; cy: number; size: number } {
  const size = Math.min(sizeHint, Math.max(roi.h * 0.5, 0.012))
  // 题号旁：ROI 左边缘外侧的页边；不够则内侧左上角
  let cx = roi.x - size * 0.9
  if (cx < size * 0.55) cx = roi.x + size * 0.75
  const cy = roi.y + size * 0.8
  return { cx, cy, size }
}

/**
 * 同页批注的「下一题顶界」计算：
 * 每题下方可用空间不超过下一题 ROI 顶部，避免回填文字压到下一题。
 * 返回 id → nextTopY 映射（无下一题时为页面底部 1）。
 */
export function computeNextTops(
  list: { id: string; roiY: number; roiH: number }[]
): Map<string, number> {
  const map = new Map<string, number>()
  const sorted = [...list].sort((a, b) => a.roiY - b.roiY)
  for (let i = 0; i < sorted.length; i++) {
    let next: number | null = null
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].roiY > sorted[i].roiY + sorted[i].roiH * 0.5 + 0.004) {
        next = sorted[j].roiY
        break
      }
    }
    map.set(sorted[i].id, next ?? 1)
  }
  return map
}

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
 * 计算某题的答案/解析/错因回填位置（v3：绝不压题目文字）。
 * 全部返回相对页面坐标；调用方乘以页面宽高即得像素坐标。
 *
 * v3 规则：
 *  1) VLM 识别的作答空白（answerRoi 在题区下半部）→ 答案写入空白处
 *  2) 行内填空 → 答案写行末空白（右对齐）
 *  3) 没有空白 → 写在 ROI 正下方（两题之间的空隙，受下一题顶界限制）
 *  4) 下方没空间 → 写在 ROI 正上方
 *  5) 上下都没空间（占满页）→ 右侧边栏
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
    // 1a) 真实作答空白区（位于题目区域下半部）：答案写入空白；
    //     错因/解析优先排空白内，放不下 → 落到 ROI 正下方（绝不压题，也绝不丢弃）
    const bx0 = clamp01(ar.x!)
    const by0 = clamp01(ar.y!)
    const bw0 = Math.min(clamp01(ar.w!), 1 - bx0)
    const bh0 = Math.min(clamp01(ar.h!), 1 - by0)
    const plan: BackfillPlan = { answer: null, solution: null, reason: null }
    if (answer) {
      plan.answer = {
        x: bx0, y: by0, w: bw0, h: Math.min(bh0, ANSWER_H), mode: 'blank', label: '答',
      }
    }
    let cyIn = by0 + (answer ? Math.min(bh0, ANSWER_H) + GAP : 0)

    // ROI 下方兜底光标（受下一题顶界限制）
    const roiBottom0 = roi.y + roi.h
    const limitY0 = Math.min(a.nextTopY ?? 1, 1) - 0.003
    let cyBelow = roiBottom0 + 0.003
    const belowX0 = clamp01(roi.x + roi.w * 0.14)
    const belowW0 = Math.min(Math.max(roi.w * 0.86, 0.3), 1 - belowX0)
    const belowFits = (h: number) => cyBelow + h <= limitY0

    if (reason) {
      if (cyIn + REASON_H <= by0 + bh0 + 0.01) {
        plan.reason = { x: bx0, y: cyIn, w: bw0, h: REASON_H, mode: 'blank' }
        cyIn += REASON_H + GAP
      } else if (belowFits(REASON_H)) {
        plan.reason = { x: belowX0, y: cyBelow, w: belowW0, h: REASON_H, mode: 'below' }
        cyBelow += REASON_H + GAP
      }
    }
    if (solution) {
      if (cyIn + SOLUTION_H <= by0 + bh0 + 0.012) {
        plan.solution = { x: bx0, y: cyIn, w: bw0, h: SOLUTION_H, mode: 'blank' }
      } else if (answer && bw0 >= 0.45 && !plan.reason) {
        // 高度不够但横向富余 → 解析跟在答案右侧
        plan.solution = {
          x: bx0 + Math.min(bw0 * 0.42, 0.22),
          y: by0,
          w: bw0 * 0.55,
          h: Math.min(bh0, ANSWER_H),
          mode: 'blank',
        }
      } else if (belowFits(SOLUTION_H)) {
        plan.solution = { x: belowX0, y: cyBelow, w: belowW0, h: SOLUTION_H, mode: 'below' }
        cyBelow += SOLUTION_H + GAP
      }
    }
    return plan
  }

  if (arPresent && answer) {
    // 1b) 行内填空（answerRoi 在题干行上）：答案写在行末空白（右对齐）；
    //     错因/解析紧跟答案正下方一行（小字），页底放不下则改放答案上方
    const lineRight = clamp01(ar.x! + ar.w!)
    const boxW = Math.min(Math.max(clamp01(ar.w!) * 0.35, 0.14), 0.22)
    const bx = clamp01(lineRight - boxW)
    const by = clamp01(ar.y!)
    const plan: BackfillPlan = {
      answer: {
        x: bx,
        y: by,
        w: Math.min(boxW, 1 - bx),
        h: Math.min(clamp01(ar.h!), ANSWER_H),
        mode: 'inline',
        label: '答',
      },
      solution: null,
      reason: null,
    }
    const arBottom = clamp01(ar.y! + ar.h!)
    // 错因/解析位置（安全优先级）：
    //  1) ROI 正下方（题与题之间的空白，受下一题顶界限制）
    //  2) 答案区正下方 —— 仅当答案是「大作答区」(ar.h≥0.06) 或 位于题目尾段（ar.y ≥ roi 底部 55%）
    //  3) 答案区上方（页底放不下时）
    //  4) 都不行 → 不落位（该题错因见解析 PDF），绝不压题干
    const roiBottomB = roi.y + roi.h
    const limitYB = Math.min(a.nextTopY ?? 1, 1) - 0.003
    const nearEnd =
      roi.h <= 0.075 || // 单行小题：答案行即题尾，arBottom 下方即题间空隙
      ar.y! >= roi.y + roi.h * 0.55 || // 空在题目尾段
      ar.h! >= 0.06 // 大作答区，下方仍是本题空间
    let cy: number | null = null
    if (roiBottomB + 0.004 + REASON_H <= limitYB) {
      cy = roiBottomB + 0.004
    } else if (nearEnd && arBottom + 0.004 + REASON_H <= 1) {
      cy = arBottom + 0.004
    } else if (ar.y! - REASON_H - 0.004 >= 0 && roiBottomB >= 0.999) {
      cy = clamp01(ar.y! - REASON_H - 0.004)
    }
    if (cy != null) {
      const rx = clamp01(Math.min(bx, 1 - 0.32))
      const rw = Math.min(0.32, 1 - rx)
      if (reason) {
        plan.reason = { x: rx, y: cy, w: rw, h: REASON_H, mode: 'inline' }
        cy += REASON_H + GAP
      }
      if (solution && cy + SOLUTION_H <= 1) {
        plan.solution = { x: rx, y: cy, w: rw, h: SOLUTION_H, mode: 'inline' }
      }
    }
    return plan
  }

  // ---------- 2) ROI 正下方（两题之间的空隙）----------
  const limitY = Math.min(a.nextTopY ?? 1, 1) - 0.003 // 下一题顶界
  const roiBottom = roi.y + roi.h
  const belowRoom = limitY - roiBottom - 0.003
  if (belowRoom >= ANSWER_H + 0.002) {
    const bx = clamp01(roi.x + roi.w * 0.14)
    const bw = Math.min(Math.max(roi.w * 0.86, 0.3), 1 - bx)
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: roiBottom + 0.003, w: bw, h: ANSWER_H, mode: 'below', label: '答' }
        : null,
      solution: null,
      reason: null,
    }
    let cy = roiBottom + 0.003 + (answer ? ANSWER_H + GAP : 0)
    if (reason && cy + REASON_H <= limitY) {
      plan.reason = { x: bx, y: cy, w: bw, h: REASON_H, mode: 'below' }
      cy += REASON_H + GAP
    }
    if (solution && cy + SOLUTION_H <= limitY) {
      plan.solution = { x: bx, y: cy, w: bw, h: SOLUTION_H, mode: 'below' }
    }
    return plan
  }

  // ---------- 3) ROI 正上方 ----------
  if (roi.y >= ANSWER_H + 0.006) {
    const bx = clamp01(roi.x + roi.w * 0.14)
    const bw = Math.min(Math.max(roi.w * 0.86, 0.3), 1 - bx)
    // 答案贴着 ROI 顶部上方；错因/解析再往上排
    const ansY = roi.y - ANSWER_H - 0.003
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: clamp01(ansY), w: bw, h: ANSWER_H, mode: 'above', label: '答' }
        : null,
      solution: null,
      reason: null,
    }
    let cy = ansY
    if (reason && cy - REASON_H - GAP >= 0) {
      cy -= REASON_H + GAP
      plan.reason = { x: bx, y: cy, w: bw, h: REASON_H, mode: 'above' }
    }
    if (solution && cy - SOLUTION_H - GAP >= 0) {
      cy -= SOLUTION_H + GAP
      plan.solution = { x: bx, y: cy, w: bw, h: SOLUTION_H, mode: 'above' }
    }
    return plan
  }

  // ---------- 4) 上下都没空间（ROI 占满页面）→ 右侧边栏 ----------
  const rightX = roi.x + roi.w
  if (1 - rightX >= 0.16) {
    const bx = clamp01(rightX + 0.008)
    const bw = Math.min(0.15, 1 - bx)
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: roi.y + 0.004, w: bw, h: ANSWER_H, mode: 'beside-mark', label: '答' }
        : null,
      solution: null,
      reason: null,
    }
    let cy = roi.y + 0.004 + (answer ? ANSWER_H + GAP : 0)
    if (reason && cy + REASON_H <= 1) {
      plan.reason = { x: bx, y: cy, w: bw, h: REASON_H, mode: 'beside-mark' }
      cy += REASON_H + GAP
    }
    if (solution && cy + SOLUTION_H <= 1) {
      plan.solution = { x: bx, y: cy, w: bw, h: SOLUTION_H, mode: 'beside-mark' }
    }
    return plan
  }

  // ---------- 5) 最后兜底：ROI 下方不 clamp（宁可贴页底也不压题） ----------
  const bx = clamp01(roi.x + roi.w * 0.14)
  const bw = Math.min(Math.max(roi.w * 0.86, 0.3), 1 - bx)
  const by = clamp01(Math.min(roiBottom + 0.004, 1 - ANSWER_H - 0.003))
  const plan: BackfillPlan = {
    answer: answer
      ? { x: bx, y: by, w: bw, h: ANSWER_H, mode: 'beside-mark', label: '答' }
      : null,
    solution: null,
    reason: null,
  }
  if (reason) {
    const ry = by + ANSWER_H + GAP
    if (ry + REASON_H <= 1) plan.reason = { x: bx, y: ry, w: bw, h: REASON_H, mode: 'beside-mark' }
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
