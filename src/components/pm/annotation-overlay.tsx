'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { fileUrl, type Annotation } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'
import { JudgeMarkIcon } from './judge-icons'
import { computeBackfill, truncateForBeside, cleanAnswerText, cleanSolutionText } from '@/lib/answer-layout'

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
 * 复核叠加层：题框 / 判分标记（矢量 ⍻）/ 得分 / 答案与解析回填预览。
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
      {/* 图层开关 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">图层：</span>
        {([
          ['boxes', '题框'],
          ['marks', '判分标记'],
          ['scores', '得分'],
          ['answers', '答案/解析回填'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => toggleLayer(k)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              layers[k]
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-muted text-muted-foreground'
            }`}
          >
            {layers[k] ? '● ' : '○ '}
            {label}
          </button>
        ))}
        {pageScore && (
          <span className="ml-auto rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
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
                    ? `2px solid ${selected ? (a.judgeType === 'correct' ? '#16a34a' : a.judgeType === 'wrong' ? '#dc2626' : '#d97706') : 'rgba(37,99,235,0.65)'}`
                    : '2px solid transparent',
                  backgroundColor: selected ? 'rgba(16,185,129,0.08)' : 'rgba(37,99,235,0.04)',
                  boxShadow: selected ? '0 0 0 2px rgba(16,185,129,0.5)' : 'none',
                }}
              >
                {/* 题号 */}
                <span
                  className="absolute -top-2 left-1 rounded bg-slate-800 px-1 text-[10px] leading-4 text-white"
                  style={{ display: layers.boxes ? 'block' : 'none' }}
                >
                  {a.questionText?.slice(0, 12) || '题'}
                </span>

                {/* 判分标记 右上角（矢量 ⍻） */}
                {layers.marks && (
                  <div className="absolute right-0.5 top-0.5 rounded bg-white/85 p-0.5">
                    <JudgeMarkIcon type={a.judgeType} size={20} />
                  </div>
                )}

                {/* 得分 左下 */}
                {layers.scores && (
                  <div className="absolute bottom-0.5 left-1 rounded bg-slate-900/80 px-1 text-[10px] font-semibold text-white">
                    {a.getScore}/{a.fullScore}
                  </div>
                )}
              </div>
            )
          })}

        {/* 答案/解析回填预览（页面级坐标，与 PDF 同一套布局算法，不随题框缩放） */}
        {imgLoaded &&
          layers.answers &&
          annotations.map((a) => <BackfillPreview key={`bf-${a.id}`} annotation={a} onSelect={() => setSelected(a.id)} />)}
      </div>
    </div>
  )
}

/** 答案/解析回填预览：复用 answer-layout 算法（页面级相对坐标），位置与打印输出一致 */
function BackfillPreview({
  annotation: a,
  onSelect,
}: {
  annotation: Annotation
  onSelect: () => void
}) {
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
  if (!plan.answer && !plan.solution) return null

  return (
    <>
      {plan.answer && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          className="absolute flex cursor-pointer items-center overflow-hidden rounded bg-emerald-600/15 px-1 text-[10px] font-bold leading-tight text-emerald-700 ring-1 ring-emerald-600/25"
          style={{
            left: `${plan.answer.x * 100}%`,
            top: `${plan.answer.y * 100}%`,
            width: `${plan.answer.w * 100}%`,
            height: `${plan.answer.h * 100}%`,
          }}
        >
          <span className="truncate">
            答：
            {plan.answer.mode === 'beside-mark' || plan.answer.mode === 'inline'
              ? truncateForBeside(cleanAnswerText(a.answerText), 12)
              : cleanAnswerText(a.answerText)}
          </span>
        </div>
      )}
      {plan.solution && (
        <div
          className="pointer-events-none absolute flex items-center overflow-hidden px-1 text-[9px] leading-tight text-slate-500"
          style={{
            left: `${plan.solution.x * 100}%`,
            top: `${plan.solution.y * 100}%`,
            width: `${plan.solution.w * 100}%`,
            height: `${plan.solution.h * 100}%`,
          }}
        >
          <span className="truncate">析：{cleanSolutionText(a.fullSolution || a.briefReason).slice(0, 40)}</span>
        </div>
      )}
    </>
  )
}
