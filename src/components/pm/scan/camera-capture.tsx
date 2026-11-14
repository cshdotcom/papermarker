'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Check, CameraOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onCapture: (file: File) => void
  pageCount: number
  onDone: () => void
}

/**
 * 手机相机取景器（APP 端）：
 * getUserMedia 调用后置摄像头实时取景，拍一张回调一次；
 * 相机不可用（无权限/无摄像头/桌面无设备）自动降级为文件选择。
 */
export function CameraCapture({ onCapture, pageCount, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting')
  const [errMsg, setErrMsg] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        if (!cancelled) setState('live')
      } catch (e: any) {
        if (cancelled) return
        setState('error')
        setErrMsg(e?.name === 'NotAllowedError' ? '相机权限被拒绝' : '无法访问相机')
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth
    cv.height = v.videoHeight
    cv.getContext('2d')!.drawImage(v, 0, 0)
    cv.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.95
    )
  }

  const pick = (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) onCapture(f)
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black" style={{ aspectRatio: '3 / 4' }}>
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ display: state === 'live' ? 'block' : 'none' }}
      />

      {state !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center">
          {state === 'starting' ? (
            <>
              <Camera className="h-10 w-10 animate-pulse text-muted-foreground" />
              <p className="text-sm text-muted-foreground">正在启动相机…</p>
            </>
          ) : (
            <>
              <CameraOff className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {errMsg || '相机不可用'}，可选择相册图片
              </p>
            </>
          )}
        </div>
      )}

      {/* 取景引导框 */}
      {state === 'live' && (
        <div className="pointer-events-none absolute inset-4 rounded-lg border-2 border-dashed border-white/70">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-[11px] text-white">
            将试卷对准框内
          </span>
        </div>
      )}

      {/* 顶部：已拍页数 + 切换镜头 */}
      {state === 'live' && (
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
            已拍 {pageCount} 页
          </span>
          <button
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            className="rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
            aria-label="切换镜头"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 底部操作条 */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent p-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileRef.current?.click()}
          className="rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white"
          aria-label="从相册选择"
        >
          <ImagePlus className="h-5 w-5" />
        </Button>

        {state === 'live' ? (
          <button
            onClick={capture}
            className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-emerald-600 shadow-lg transition active:scale-95"
            aria-label="拍照"
          >
            <Camera className="h-6 w-6 text-white" />
          </button>
        ) : (
          <div className="h-16 w-16" />
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={onDone}
          disabled={pageCount === 0}
          className="rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white disabled:opacity-40"
          aria-label="完成拍摄"
        >
          <Check className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
