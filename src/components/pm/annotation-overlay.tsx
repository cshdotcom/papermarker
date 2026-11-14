'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { fileUrl, type Annotation, type BlankInfo } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { JudgeMarkIcon } from './judge-icons'
import {
  computeBackfill,
  computeBlankMarks,
  truncateForBeside,
  cleanAnswerText,
  cleanSolutionText,
  cleanReasonText,
} from '@/lib/answer-layout'

export interface OverlayPage {
  pageNo: number
  fileId: string
  w: number
  h: number
}

interface Props {
  page: OverlayPage
  annotations: Annotation[]
  pageScore?: { get: number; full: number }
}

/**
 * 复核叠加层 v2：题框 / 小号判分标记（矢量⍻）/ 每空小标记 / 小得分 / 答案·错因·解析回填预览。
 * 答案回填与批注 PDF、Brother JPEG 使用同一套布局算法（answer-layout.ts），
 * 界面所见 = 打印所得。
 */
export function AnnotationOverlay({ page, annotations, pageScore }: Props) {
  const { layers, selectedAnnotationId, setSelected, toggleLayer } = usePm()
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)

  const aspect = page.w && page.h ? page.w / page.h : 0.707

  return (
    <div className="flex flex-col gap-2">
      {/* 图层开关（v2：错因/解析独立开关，默认错因+答案开） */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">图层：</span>
        {([
          ['marks', '判分标记'],
          ['scores', '得分'],
          ['answers', '答案'],
          ['reason', '错因'],
          ['solution', '解析'],
          ['boxes', '题框'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => toggleLayer(k)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
              layers[k]
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-muted text-muted-foreground'
            }`}
          >
            {layers[k] ? '●' : '○'} {label}
          </button>
        ))}
        {pageScore && (
          <span className="ml-auto rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
            本页 {pageScore.get}/{pageScore.full}
          </span>
        )}
      </div>

      {/* 图片 + 叠加层 */}
      <div
        className="relative w-full overflow-hidden rounded-lg border bg-muted/30"
        style={{ aspectRatio: `1 / ${1 / aspect}` }}
      >
        {!imgError ? (
          <img
            src={fileUrl(page.fileId)}
            alt={`试卷第${page.pageNo}页`}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              setImgLoaded(true)
              setImgError(true)
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground">
            <ImageOff className="h-8 w-8 opacity-50" />
            <p className="text-xs">原图加载失败（文件可能已删除）</p>
          </div>
        )}

        {imgLoaded &&
          annotations.map((a) => {
            const selected = a.id === selectedAnnotationId
            return (
              <div
                key={a.id}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(a.id)
                }}
                className="group absolute cursor-pointer rounded transition"
                style={{
                  left: `${a.roi.x * 100}%`,
                  top: `${a.roi.y * 100}%`,
                  width: `${a.roi.w * 100}%`,
                  height: `${a.roi.h * 100}%`,
                  border: layers.boxes
                    ? `1.5px solid ${selected ? (a.judgeType === 'correct' ? '#16a34a' : a.judgeType === 'wrong' ? '#dc2626' : '#d97706') : 'rgba(37,99,235,0.6)'}`
                    : '1.5px solid transparent',
                  backgroundColor: selected ? 'rgba(16,185,129,0.08)' : 'transparent',
                  boxShadow: selected ? '0 0 0 2px rgba(16,185,129,0.5)' : 'none',
                }}
              >
                {/* 题号（题框开时显示） */}
                <span
                  className="absolute -top-2 left-1 rounded bg-slate-800 px-1 text-[9px] leading-4 text-white"
                  style={{ display: layers.boxes ? 'block' : 'none' }}
                >
                  {a.questionText?.slice(0, 10) || '题'}
                </span>

                {/* 题级判分标记：右上角（v2 小号矢量 ⍻） */}
                {layers.marks && (
                  <div className="absolute right-0.5 top-0.5 rounded bg-white/80 p-[1px]">
                    <JudgeMarkIcon type={a.judgeType} size={14} strokeWidth={2.6} />
                  </div>
                )}

                {/* 每题得分：左下角小字（v2 更小） */}
                {layers.scores && (
                  <div className="absolute bottom-0 left-0.5 rounded bg-slate-900/75 px-1 text-[9px] font-semibold leading-4 text-white">
                    {a.getScore}/{a.fullScore}
                  </div>
                )}
              </div>
            )
          })}

        {/* 每空小标记（v2：小√×⍻ + 小得分 + 空内答案，贴在空旁的小空位） */}
        {imgLoaded &&
          layers.marks &&
          annotations.map((a) => (
            <BlankMarksLayer
              key={`bm-${a.id}`}
              blanks={a.blanks}
              showScores={layers.scores}
              showAnswers={layers.answers}
              onSelect={() => setSelected(a.id)}
            />
          ))}

        {/* 答案/错因/解析回填预览（页面级坐标，与 PDF 同一套布局算法，不随题框缩放） */}
        {imgLoaded &&
          annotations.map((a) => (
            <BackfillPreview key={`bf-${a.id}`} annotation={a} onSelect={() => setSelected(a.id)} />
          ))}
      </div>
    </div>
  )
}

/** 每空小标记层 */
function BlankMarksLayer({
  blanks,
  showScores,
  showAnswers,
  onSelect,
}: {
  blanks: BlankInfo[] | null
  showScores: boolean
  showAnswers: boolean
  onSelect: () => void
}) {
  if (!blanks || blanks.length === 0) return null
  const marks = computeBlankMarks(
    blanks.map((b) => ({
      roiX: b.roiX,
      roiY: b.roiY,
      roiW: b.roiW,
      roiH: b.roiH,
      judge: b.judge,
      getScore: b.getScore,
      fullScore: b.fullScore,
      answerText: b.answerText,
    }))
  )
  if (marks.length === 0) return null

  return (
    <>
      {marks.map((m, i) => (
        <div key={i}>
          {/* 小标记 + 小得分（空右侧，不占空间） */}
          <div
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
            className="absolute flex -translate-y-1/2 -translate-x-1/2 cursor-pointer items-center gap-0.5"
            style={{
              left: `${m.cx * 100}%`,
              top: `${m.cy * 100}%`,
            }}
          >
            <div className="rounded-sm bg-white/80 p-[1px]">
              <JudgeMarkIcon type={m.judge} size={11} strokeWidth={3} />
            </div>
            {showScores && m.scoreText && (
              <span className="rounded-sm bg-slate-900/75 px-0.5 text-[8px] font-semibold leading-3 text-white">
                {m.scoreText}
              </span>
            )}
          </div>
          {/* 空内正确答案（错/半对的空，小字居中） */}
          {showAnswers && m.answerText && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
              }}
              className="pointer-events-none absolute flex -translate-y-1/2 items-center justify-center px-0.5"
              style={{
                left: `${m.box.x * 100}%`,
                top: `${(m.box.y + m.box.h / 2) * 100}%`,
                width: `${m.box.w * 100}%`,
                height: `${m.box.h * 100}%`,
              }}
            >
              <span className="truncate text-[10px] font-bold leading-none text-emerald-700">
                {m.answerText}
              </span>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/** 答案/错因/解析回填预览：复用 answer-layout 算法（页面级相对坐标），位置与打印输出一致 */
function BackfillPreview({
  annotation: a,
  onSelect,
}: {
  annotation: Annotation
  onSelect: () => void
}) {
  const { layers } = usePm()
  const plan = computeBackfill({
    roiX: a.roi.x,
    roiY: a.roi.y,
    roiW: a.roi.w,
    roiH: a.roi.h,
    answerRoiX: a.answerRoi?.x,
    answerRoiY: a.answerRoi?.y,
    answerRoiW: a.answerRoi?.w,
    answerRoiH: a.answerRoi?.h,
    answerText: a.answerText,
    fullSolution: a.fullSolution,
    briefReason: a.briefReason,
    judgeType: a.judgeType,
  })
  // 一题多空：答案已写入每个空内（BlankMarksLayer），跳过题级答案避免重复重叠
  const hasBlanks = a.blanks && a.blanks.length > 0
  if ((!plan.answer || hasBlanks) && !plan.solution && !plan.reason) return null
  const beside = (m: string) => m === 'beside-mark' || m === 'inline'

  return (
    <>
      {layers.answers && plan.answer && !hasBlanks && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          className="absolute flex cursor-pointer items-center overflow-hidden rounded bg-emerald-600/15 px-0.5 text-[10px] font-bold leading-tight text-emerald-700 ring-1 ring-emerald-600/25"
          style={{
            left: `${plan.answer.x * 100}%`,
            top: `${plan.answer.y * 100}%`,
            width: `${plan.answer.w * 100}%`,
            height: `${plan.answer.h * 100}%`,
          }}
        >
          <span className="truncate">
            答：
            {beside(plan.answer.mode)
              ? truncateForBeside(cleanAnswerText(a.answerText), 12)
              : truncateForBeside(cleanAnswerText(a.answerText), 24)}
          </span>
        </div>
      )}
      {layers.reason && plan.reason && (
        <div
          className="pointer-events-none absolute flex items-center overflow-hidden px-0.5 text-[9px] leading-tight text-amber-700"
          style={{
            left: `${plan.reason.x * 100}%`,
            top: `${plan.reason.y * 100}%`,
            width: `${plan.reason.w * 100}%`,
            height: `${plan.reason.h * 100}%`,
          }}
        >
          <span className="truncate">
            错因：{truncateForBeside(cleanReasonText(a.briefReason), beside(plan.reason.mode) ? 18 : 30)}
          </span>
        </div>
      )}
      {layers.solution && plan.solution && (
        <div
          className="pointer-events-none absolute flex items-center overflow-hidden px-0.5 text-[9px] leading-tight text-slate-500"
          style={{
            left: `${plan.solution.x * 100}%`,
            top: `${plan.solution.y * 100}%`,
            width: `${plan.solution.w * 100}%`,
            height: `${plan.solution.h * 100}%`,
          }}
        >
          <span className="truncate">
            析：{truncateForBeside(cleanSolutionText(a.fullSolution || a.briefReason), beside(plan.solution.mode) ? 18 : 34)}
          </span>
        </div>
      )}
    </>
  )
}
