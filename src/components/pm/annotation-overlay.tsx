'use client'

import { useState } from 'react'
import { fileUrl, type Annotation } from '@/lib/pm'
import { usePm } from '@/lib/pm-store'

const JUDGE_COLOR: Record<string, string> = {
  correct: '#16a34a',
  wrong: '#dc2626',
  partial: '#d97706',
}

function JudgeMark({ type, size = 22 }: { type: string; size?: number }) {
  const c = JUDGE_COLOR[type] || JUDGE_COLOR.wrong
  // √
  if (type === 'correct') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 12.5 L9.5 18 L20 6"
          stroke={c}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  // ×
  if (type === 'wrong') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M6 6 L18 18 M18 6 L6 18" stroke={c} strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  // 半对：先打个完整的勾，勾的上方再打一个叉
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12.5 L9.5 18 L20 6"
        stroke={c}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 1.2 L18.6 10.6 M18.6 1.2 L9.2 10.6"
        stroke={c}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

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

export function AnnotationOverlay({ page, annotations, pageScore }: Props) {
  const { layers, selectedAnnotationId, setSelected, toggleLayer } = usePm()
  const [imgLoaded, setImgLoaded] = useState(false)

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
          ['answers', '答案'],
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
        <img
          src={fileUrl(page.fileId)}
          alt={`试卷第${page.pageNo}页`}
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={() => setImgLoaded(true)}
        />

        {imgLoaded &&
          annotations.map((a) => {
            const selected = a.id === selectedAnnotationId
            const color = JUDGE_COLOR[a.judgeType] || JUDGE_COLOR.wrong
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
                    ? `2px solid ${selected ? color : 'rgba(37,99,235,0.65)'}`
                    : '2px solid transparent',
                  backgroundColor: selected ? `${color}22` : 'rgba(37,99,235,0.04)',
                  boxShadow: selected ? `0 0 0 2px ${color}` : 'none',
                }}
              >
                {/* 题号 */}
                <span
                  className="absolute -top-2 left-1 rounded bg-slate-800 px-1 text-[10px] leading-4 text-white"
                  style={{ display: layers.boxes ? 'block' : 'none' }}
                >
                  {a.questionText?.slice(0, 12) || '题'}
                </span>

                {/* 判分标记 右上角 */}
                {layers.marks && (
                  <div className="absolute right-0.5 top-0.5 rounded bg-white/80 p-0.5">
                    <JudgeMark type={a.judgeType} size={20} />
                  </div>
                )}

                {/* 得分 左下 */}
                {layers.scores && (
                  <div className="absolute bottom-0.5 left-1 rounded bg-slate-900/80 px-1 text-[10px] font-semibold text-white">
                    {a.getScore}/{a.fullScore}
                  </div>
                )}

                {/* 答案 右下 */}
                {layers.answers && a.answerText && (
                  <div className="absolute bottom-0.5 right-0.5 max-w-[70%] truncate rounded bg-emerald-600/90 px-1 text-[10px] text-white">
                    答：{a.answerText}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
