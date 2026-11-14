'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCw, Sparkles, X, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  detectCorners,
  warpImage,
  applyLocalThreshold,
  loadImageBitmap,
  type Pt,
  type EnhanceFilter,
} from '@/lib/client/scan'

interface Props {
  file: File
  index: number
  total: number
  onDone: (blob: Blob) => void
  onCancel: () => void
}

const FILTERS: { key: EnhanceFilter; label: string }[] = [
  { key: 'none', label: '原图' },
  { key: 'color', label: '彩色增强' },
  { key: 'gray', label: '灰度' },
  { key: 'bw', label: '黑白去底' },
]

function defaultCorners(w: number, h: number): Pt[] {
  return [
    { x: w * 0.06, y: h * 0.04 },
    { x: w * 0.94, y: h * 0.04 },
    { x: w * 0.94, y: h * 0.96 },
    { x: w * 0.06, y: h * 0.96 },
  ]
}

/**
 * 四角调节器（APP 端）：
 * 自动检测文档四角 → 手动拖角微调 → 透视矫正 + 增强滤镜 → 输出 JPEG。
 */
export function CornerEditor({ file, index, total, onDone, onCancel }: Props) {
  const imgRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bmpRef = useRef<ImageBitmap | null>(null)
  const [corners, setCorners] = useState<Pt[] | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [detecting, setDetecting] = useState(true)
  const [filter, setFilter] = useState<EnhanceFilter>('color')
  const [processing, setProcessing] = useState(false)
  const dragIdx = useRef<number>(-1)

  // 加载 + 自动检测
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setDetecting(true)
      setCorners(null)
      try {
        const { bmp, w, h } = await loadImageBitmap(file)
        if (cancelled) return
        bmpRef.current = bmp
        setSize({ w, h })
        // 绘制预览
        const cv = imgRef.current
        if (cv) {
          cv.width = w
          cv.height = h
          cv.getContext('2d')!.drawImage(bmp, 0, 0)
        }
        const pts = await detectCorners(bmp, w, h)
        if (cancelled) return
        setCorners(pts || defaultCorners(w, h))
      } catch {
        // 加载失败：保持 corners=null，用户只能取消
      } finally {
        if (!cancelled) setDetecting(false)
      }
    })()
    return () => {
      cancelled = true
      bmpRef.current?.close?.()
    }
  }, [file])

  const redetect = async () => {
    const bmp = bmpRef.current
    if (!bmp || !size) return
    setDetecting(true)
    const pts = await detectCorners(bmp, size.w, size.h)
    setCorners(pts || defaultCorners(size.w, size.h))
    setDetecting(false)
  }

  const rotate = () => {
    const bmp = bmpRef.current
    if (!bmp || !size) return
    // 旋转位图 90°
    const cv = document.createElement('canvas')
    cv.width = size.h
    cv.height = size.w
    const ctx = cv.getContext('2d')!
    ctx.translate(cv.width / 2, cv.height / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(bmp, -size.w / 2, -size.h / 2)
    cv.toBlob(async (blob) => {
      if (!blob) return
      const { bmp: nb, w, h } = await loadImageBitmap(blob)
      bmpRef.current = nb
      setSize({ w, h })
      const pcv = imgRef.current
      if (pcv) {
        pcv.width = w
        pcv.height = h
        pcv.getContext('2d')!.drawImage(nb, 0, 0)
      }
      setCorners(defaultCorners(w, h))
    }, 'image/jpeg', 0.95)
  }

  // 拖拽角点
  const onPointerDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    dragIdx.current = i
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current < 0 || !corners || !wrapRef.current || !size) return
    const r = wrapRef.current.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * size.w
    const y = ((e.clientY - r.top) / r.height) * size.h
    const i = dragIdx.current
    setCorners(
      corners.map((c, j) =>
        j === i
          ? {
              x: Math.min(size.w, Math.max(0, x)),
              y: Math.min(size.h, Math.max(0, y)),
            }
          : c
      )
    )
  }
  const onPointerUp = () => {
    dragIdx.current = -1
  }

  const confirm = () => {
    const bmp = bmpRef.current
    if (!bmp || !corners || !size) return
    setProcessing(true)
    setTimeout(async () => {
      try {
        let canvas = warpImage(bmp, size.w, size.h, corners, filter)
        if (filter === 'bw') applyLocalThreshold(canvas)
        canvas.toBlob(
          (blob) => {
            setProcessing(false)
            if (blob) onDone(blob)
          },
          'image/jpeg',
          0.92
        )
      } catch {
        setProcessing(false)
      }
    }, 30)
  }

  const HANDLE_NAMES = ['左上', '右上', '右下', '左下']

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between gap-2 p-3">
        <Button variant="ghost" size="icon" onClick={onCancel} className="text-white hover:bg-white/10 hover:text-white" aria-label="放弃本页">
          <X className="h-5 w-5" />
        </Button>
        <div className="text-sm font-medium text-white">
          调节边角（{index + 1}/{total}）
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={rotate}
          className="text-white hover:bg-white/10 hover:text-white"
          aria-label="旋转"
        >
          <RotateCw className="h-5 w-5" />
        </Button>
      </div>

      {/* 编辑区：容器限定尺寸，aspect-ratio 包裹器保证画布完整可见且角点永不溢出 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
        <div
          ref={wrapRef}
          className="relative max-h-full max-w-full touch-none select-none"
          style={{
            aspectRatio: size ? `${size.w} / ${size.h}` : undefined,
            width: size && size.w >= size.h ? '100%' : undefined,
            height: size && size.w < size.h ? '100%' : undefined,
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas
            ref={imgRef}
            className="absolute inset-0 block h-full w-full rounded"
          />
          {corners && (
            <>
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <polygon
                  points={corners.map((c) => `${(c.x / (size?.w || 1)) * 100}%,${(c.y / (size?.h || 1)) * 100}%`).join(' ')}
                  fill="rgba(16,185,129,0.12)"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeDasharray="10 5"
                />
              </svg>
              {corners.map((c, i) => (
                <button
                  key={i}
                  onPointerDown={onPointerDown(i)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
                  style={{
                    left: `${(c.x / (size?.w || 1)) * 100}%`,
                    top: `${(c.y / (size?.h || 1)) * 100}%`,
                  }}
                  aria-label={`拖动${HANDLE_NAMES[i]}角`}
                >
                  <span className="h-6 w-6 rounded-full border-2 border-white bg-emerald-600 shadow-lg" />
                </button>
              ))}
            </>
          )}
          {detecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在识别文档边缘…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部控制条 */}
      <div className="space-y-3 border-t border-white/10 bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                filter === f.key
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/20 text-white/70 hover:border-white/40'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={redetect}
            disabled={detecting}
            className="flex items-center gap-1 rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/40 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            重新识别
          </button>
        </div>
        <Button
          onClick={confirm}
          disabled={!corners || processing || detecting}
          className="w-full bg-emerald-600 py-6 text-base hover:bg-emerald-700"
        >
          {processing ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              正在矫正增强…
            </>
          ) : (
            <>
              <Check className="mr-2 h-5 w-5" />
              确认本页
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
