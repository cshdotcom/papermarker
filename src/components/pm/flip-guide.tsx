'use client'

import { motion } from 'framer-motion'

/**
 * 手动双面翻面引导动画：纸张沿 Y 轴翻转 180°，循环演示手动双面打印的翻面动作。
 */
export function FlipGuide({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className || ''}`}>
      <div
        className="relative"
        style={{ width: 160, height: 200, perspective: 800 }}
      >
        <motion.div
          className="absolute inset-0 rounded-md border-2 border-emerald-500 bg-white shadow-lg"
          style={{ transformStyle: 'preserve-3d', transformOrigin: 'center center' }}
          animate={{ rotateY: [0, 180, 360] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* 正面 */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-xs font-semibold text-emerald-600">正面</div>
            <div className="h-1 w-20 rounded bg-emerald-200" />
            <div className="h-1 w-16 rounded bg-emerald-200" />
            <div className="h-1 w-20 rounded bg-emerald-200" />
            <div className="mt-2 text-[10px] text-muted-foreground">A 面打印</div>
          </div>
          {/* 反面 */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-amber-500 bg-amber-50 p-3"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="text-xs font-semibold text-amber-600">反面</div>
            <div className="h-1 w-16 rounded bg-amber-200" />
            <div className="h-1 w-20 rounded bg-amber-200" />
            <div className="h-1 w-16 rounded bg-amber-200" />
            <div className="mt-2 text-[10px] text-muted-foreground">B 面打印</div>
          </div>
        </motion.div>
      </div>
      <p className="max-w-[220px] text-center text-xs text-muted-foreground">
        手动双面打印：A 面打印完成后，将纸张翻面重新放入进纸器，再打印 B 面。
      </p>
    </div>
  )
}
