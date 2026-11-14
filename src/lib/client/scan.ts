/**
 * 客户端扫描工具（APP 端核心算法，纯浏览器运行）：
 *  1. detectCorners   自动检测文档四角（灰度→模糊→Sobel→背景洪泛→最大亮团→四向极值点）
 *  2. warpImage       四点透视矫正（计算单应性矩阵 + 双线性采样）
 *  3. applyLocalThreshold  黑白增强/去底色（积分图局部自适应阈值，去阴影）
 */

export interface Pt {
  x: number
  y: number
}

export type EnhanceFilter = 'none' | 'color' | 'gray' | 'bw'

// ---------- 线性代数：解 8x8 线性方程组 ----------
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    // 选主元
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-10) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/**
 * 计算单应性矩阵 H（把 dst 四点映射到 src 四点，3x3 行主序）：
 * 用于逐目标像素反向采样，无需矩阵求逆。
 */
export function computeHomography(dst: Pt[], src: Pt[]): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = src[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    b.push(y)
  }
  const h = solveLinear(A, b)
  if (!h) return null
  return [...h, 1]
}

// ---------- 文档四角自动检测 ----------
export async function detectCorners(
  source: CanvasImageSource,
  sw: number,
  sh: number
): Promise<Pt[] | null> {
  const W = 360
  const scale = W / sw
  const H = Math.max(1, Math.round(sh * scale))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data

  const gray = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }

  // 简单盒式模糊去噪
  const blur = new Float32Array(W * H)
  const r = 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      let c = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          s += gray[yy * W + xx]
          c++
        }
      }
      blur[y * W + x] = s / c
    }
  }

  // Sobel 梯度
  const mag = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx =
        -blur[i - W - 1] - 2 * blur[i - 1] - blur[i + W - 1] +
        blur[i - W + 1] + 2 * blur[i + 1] + blur[i + W + 1]
      const gy =
        -blur[i - W - 1] - 2 * blur[i - W] - blur[i - W + 1] +
        blur[i + W - 1] + 2 * blur[i + W] + blur[i + W + 1]
      mag[i] = Math.hypot(gx, gy)
    }
  }

  // 阈值：均值 + 1.1×标准差
  let mean = 0
  for (let i = 0; i < mag.length; i++) mean += mag[i]
  mean /= mag.length
  let varSum = 0
  for (let i = 0; i < mag.length; i++) varSum += (mag[i] - mean) ** 2
  const thr = mean + 1.1 * Math.sqrt(varSum / mag.length)

  // 从四条边洪泛非边缘像素 → 标记为背景
  const isEdge = new Uint8Array(W * H)
  for (let i = 0; i < mag.length; i++) if (mag[i] > thr) isEdge[i] = 1
  const bg = new Uint8Array(W * H)
  const queue: number[] = []
  const pushBg = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = y * W + x
    if (bg[i] || isEdge[i]) return
    bg[i] = 1
    queue.push(i)
  }
  for (let x = 0; x < W; x++) {
    pushBg(x, 0)
    pushBg(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    pushBg(0, y)
    pushBg(W - 1, y)
  }
  while (queue.length) {
    const i = queue.pop()!
    const x = i % W
    const y = (i / W) | 0
    pushBg(x - 1, y)
    pushBg(x + 1, y)
    pushBg(x, y - 1)
    pushBg(x, y + 1)
  }

  // 未标记为背景的连通亮区 → 文档主体（取最大团）
  const visited = new Uint8Array(W * H)
  let best: number[] = []
  for (let s = 0; s < W * H; s++) {
    if (visited[s] || bg[s] || isEdge[s]) continue
    const comp: number[] = []
    const q = [s]
    visited[s] = 1
    while (q.length) {
      const i = q.pop()!
      comp.push(i)
      const x = i % W
      const y = (i / W) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
        const j = yy * W + xx
        if (visited[j] || bg[j] || isEdge[j]) continue
        visited[j] = 1
        q.push(j)
      }
    }
    if (comp.length > best.length) best = comp
  }

  if (best.length < W * H * 0.12) return null

  // 四个对角方向的最远点 = 四角
  let cx = 0
  let cy = 0
  for (const i of best) {
    cx += i % W
    cy += (i / W) | 0
  }
  cx /= best.length
  cy /= best.length

  let TL = best[0]
  let TR = best[0]
  let BR = best[0]
  let BL = best[0]
  let mTL = Infinity
  let mTR = -Infinity
  let mBR = -Infinity
  let mBL = Infinity
  for (const i of best) {
    const dx = (i % W) - cx
    const dy = ((i / W) | 0) - cy
    const s1 = dx + dy
    const s2 = dx - dy
    if (s1 < mTL) {
      mTL = s1
      TL = i
    }
    if (s2 > mTR) {
      mTR = s2
      TR = i
    }
    if (s1 > mBR) {
      mBR = s1
      BR = i
    }
    if (s2 < mBL) {
      mBL = s2
      BL = i
    }
  }

  const inv = 1 / scale
  const toPt = (i: number): Pt => ({
    x: Math.min(sw, Math.max(0, (i % W) * inv)),
    y: Math.min(sh, Math.max(0, ((i / W) | 0) * inv)),
  })
  return [toPt(TL), toPt(TR), toPt(BR), toPt(BL)]
}

// ---------- 透视矫正 ----------
function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * 四点透视矫正：把 corners（TL,TR,BR,BL）内的内容拉直为矩形。
 * filter: color=彩色增强 / gray=灰度 / bw=黑白增强（后续单独处理）
 */
export function warpImage(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  corners: Pt[],
  filter: EnhanceFilter = 'none',
  maxDim = 1800
): HTMLCanvasElement {
  const [tl, tr, br, bl] = corners
  let outW = Math.round((dist(tl, tr) + dist(bl, br)) / 2)
  let outH = Math.round((dist(tl, bl) + dist(tr, br)) / 2)
  const k = Math.min(1, maxDim / Math.max(outW, outH, 1))
  outW = Math.max(32, Math.round(outW * k))
  outH = Math.max(32, Math.round(outH * k))

  // 取原图像素
  const srcCv = document.createElement('canvas')
  srcCv.width = sw
  srcCv.height = sh
  const sctx = srcCv.getContext('2d')!
  sctx.drawImage(source, 0, 0, sw, sh)
  const sd = sctx.getImageData(0, 0, sw, sh).data

  const H = computeHomography(
    [
      { x: 0, y: 0 },
      { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 },
      { x: 0, y: outH - 1 },
    ],
    [tl, tr, br, bl]
  )

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')!
  const od = octx.createImageData(outW, outH)
  const o = od.data

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 4
      let sx = -1
      let sy = -1
      if (H) {
        const d = H[6] * x + H[7] * y + H[8]
        if (Math.abs(d) > 1e-9) {
          sx = (H[0] * x + H[1] * y + H[2]) / d
          sy = (H[3] * x + H[4] * y + H[5]) / d
        }
      }
      if (sx >= 0 && sy >= 0 && sx < sw - 1 && sy < sh - 1) {
        const x0 = sx | 0
        const y0 = sy | 0
        const fx = sx - x0
        const fy = sy - y0
        const i00 = (y0 * sw + x0) * 4
        const i10 = i00 + 4
        const i01 = i00 + sw * 4
        const i11 = i01 + 4
        for (let c = 0; c < 3; c++) {
          const v =
            sd[i00 + c] * (1 - fx) * (1 - fy) +
            sd[i10 + c] * fx * (1 - fy) +
            sd[i01 + c] * (1 - fx) * fy +
            sd[i11 + c] * fx * fy
          o[i + c] = v
        }
        o[i + 3] = 255
      } else {
        o[i] = o[i + 1] = o[i + 2] = 255
        o[i + 3] = 255
      }
    }
  }
  octx.putImageData(od, 0, 0)

  // 色彩增强（canvas filter）
  if (filter === 'color' || filter === 'gray') {
    const f = document.createElement('canvas')
    f.width = outW
    f.height = outH
    const fctx = f.getContext('2d')!
    fctx.filter =
      filter === 'gray' ? 'grayscale(1) contrast(1.25)' : 'contrast(1.12) saturate(1.25) brightness(1.04)'
    fctx.drawImage(out, 0, 0)
    return f
  }
  return out
}

// ---------- 黑白增强（去底色/去阴影，积分图局部自适应阈值） ----------
export function applyLocalThreshold(canvas: HTMLCanvasElement, factor = 0.86): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  }

  // 积分图
  const integ = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += lum[y * w + x]
      integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum
    }
  }

  const radius = Math.max(8, Math.round(Math.min(w, h) / 36))
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(h - 1, y + radius)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w - 1, x + radius)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        integ[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integ[y0 * (w + 1) + (x1 + 1)] -
        integ[(y1 + 1) * (w + 1) + x0] +
        integ[y0 * (w + 1) + x0]
      const meanL = sum / area
      const i = (y * w + x) * 4
      const v = lum[y * w + x]
      // 亮于局部均值×factor → 白（纸面）；否则黑（笔迹）
      // 纯白保护：接近纯白的像素一律保留为白
      const white = v > meanL * factor || v > 242
      const val = white ? 255 : 0
      d[i] = d[i + 1] = d[i + 2] = val
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** 加载文件为位图 */
export async function loadImageBitmap(file: File | Blob): Promise<{ bmp: ImageBitmap; w: number; h: number }> {
  const bmp = await createImageBitmap(file)
  return { bmp, w: bmp.width, h: bmp.height }
}
