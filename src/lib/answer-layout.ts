/**
 * 答案/解析回填布局算法（共享）：
 * 复核界面（HTML 叠加层）、批注 PDF（pdfkit）、Brother 直连 JPEG（SVG）
 * 三端使用同一套摆放规则，保证所见即所得。
 *
 * 规则（用户需求）：
 *  - 题目有作答空白位置 → 答案自动填在空白处，解析紧随其后（小字）
 *  - 题目没有空白位置 → 答案填在勾/叉标记旁边（短文本），解析省略
 *
 * 空白位置判定：
 *  - VLM 给出的 answerRoi 必须位于题目区域下半部（真实作答空间），
 *    若 answerRoi 落在题干行内（行内填空 ____），视为「没有位置」→ 标记旁
 *  - ROI 下方留白足够（题框高、宽足够）→ 用 ROI 底部作为空白
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
}

// 判分标记位于 ROI 右上角内侧，占宽约 5%（页面比例）
const MARK_SAFE_W = 0.055

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

/**
 * 计算某题的答案/解析回填位置。
 * 全部返回相对页面坐标；调用方乘以页面宽高即得像素坐标。
 */
export function computeBackfill(a: BackfillAnn): BackfillPlan {
  // 全对的题不回填：学生已写对，再写答案只会与笔迹重叠
  if (a.judgeType === 'correct') return { answer: null, solution: null }
  const answer = cleanAnswerText(a.answerText)
  const solution = cleanSolutionText(a.fullSolution || a.briefReason)
  if (!answer && !solution) return { answer: null, solution: null }

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
    // 1a) 真实作答空白区（位于题目区域下半部）：答案写入空白，解析紧随其后
    const bx = clamp01(ar.x!)
    const by = clamp01(ar.y!)
    const bw = Math.min(clamp01(ar.w!), 1 - bx)
    const bh = Math.min(clamp01(ar.h!), 1 - by)
    const answerH = Math.min(bh, 0.032)
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: by, w: bw, h: answerH, mode: 'blank', label: '答' }
        : null,
      solution: null,
    }
    // 空白区高度富余 → 解析放在答案下方（小字灰）
    if (solution && bh >= answerH + 0.024) {
      plan.solution = {
        x: bx,
        y: by + answerH + 0.005,
        w: bw,
        h: Math.min(bh - answerH - 0.005, 0.05),
        mode: 'blank',
      }
    } else if (solution && answer && bw >= 0.45) {
      // 空白区高度不够但横向富余 → 解析跟在答案右侧
      plan.solution = {
        x: bx + Math.min(bw * 0.42, 0.22),
        y: by,
        w: bw * 0.55,
        h: answerH,
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
        h: Math.min(clamp01(ar.h!), 0.03),
        mode: 'inline',
        label: '答',
      },
      // 行内填空不附解析（交给独立解析页）
      solution: null,
    }
  }

  // ---------- 2) ROI 内部下方有空间（题框较宽较高，底部 40% 是作答区） ----------
  const roiBottomH = roi.h * 0.42
  if (roi.w >= 0.25 && roiBottomH >= 0.03) {
    const bh = Math.min(roiBottomH, 0.06)
    const by = roi.y + roi.h - bh
    const bw = roi.w * 0.82
    const bx = roi.x + roi.w - bw
    const answerH = Math.min(bh, 0.03)
    const plan: BackfillPlan = {
      answer: answer
        ? { x: bx, y: by, w: bw, h: answerH, mode: 'roi-bottom', label: '答' }
        : null,
      solution: null,
    }
    if (solution && bh >= answerH + 0.022) {
      plan.solution = {
        x: bx,
        y: by + answerH + 0.004,
        w: bw,
        h: Math.min(bh - answerH - 0.004, 0.04),
        mode: 'roi-bottom',
      }
    }
    return plan
  }

  // ---------- 3) 没有位置 → 填在勾勾叉叉旁边（标记正下方，避开题干文字） ----------
  if (!answer) return { answer: null, solution: null }
  const besideW = Math.max(Math.min(roi.w * 0.62, 0.3), 0.18)
  const bx = clamp01(roi.x + roi.w - besideW - 0.01)
  // 标记在 ROI 右上角，答案放标记正下方（ROI 下边缘外侧），不压题干
  const by = clamp01(Math.min(roi.y + roi.h + 0.004, 1 - 0.028))
  const bw = Math.min(besideW, 1 - bx)
  return {
    answer: { x: bx, y: by, w: bw, h: 0.026, mode: 'beside-mark', label: '答' },
    // beside 模式下解析省略（太挤），交给独立解析页
    solution: null,
  }
}

/** beside 模式下的短文案截断（渲染端调用） */
export function truncateForBeside(text: string, max = 16): string {
  const t = String(text || '').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}
