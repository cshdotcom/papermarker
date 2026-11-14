/**
 * eSCL (AirScan / Mopria Scan) 网络扫描仪客户端。
 * 佳能 / 兄弟 / 惠普 / 爱普生等现代网络打印机一体机原生支持，
 * 走 HTTP 8095 端口，无需厂商驱动，跨平台通用 —— 与 IPP 打印同一套理念。
 *
 * 协议要点：
 *  1. GET  {base}/ScannerCapabilities  探测能力（进纸源/色彩/分辨率/幅面）
 *  2. POST {base}/ScanJobs             下发扫描任务（XML 设置），返回 Location
 *  3. GET  {Location}/NextDocument     逐页取回扫描结果（JPEG）
 *  4. DELETE {Location}                清理任务
 */

export interface ScannerCaps {
  name: string
  platen: boolean
  adf: boolean
  duplex: boolean
  colorModes: string[]
  resolutions: number[]
  maxW: number
  maxH: number
}

export interface ProbeResult {
  ok: boolean
  msg: string
  caps?: ScannerCaps
}

export interface ScanOpts {
  source: string // Platen | Feeder
  colorMode: string // RGB24 | Grayscale8 | BlackAndWhite1
  dpi: number
}

export interface ScanPageResult {
  buffer: Buffer
  contentType: string
}

export interface ScanResult {
  ok: boolean
  msg: string
  pages: ScanPageResult[]
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function normalizeBase(esclUrl: string): string {
  let base = (esclUrl || '').trim().replace(/\/+$/, '')
  if (!base) base = 'http://192.168.1.100:8095/eSCL'
  if (!/^https?:\/\//.test(base)) base = 'http://' + base
  // 只取到 /eSCL 为止，容忍用户粘贴带子路径的地址
  return base
}

/** 宽容解析 XML（兼容 scan: / pwg: 前缀） */
function tag(xml: string, name: string): string | null {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`,
    'i'
  )
  const m = xml.match(re)
  return m ? m[1].trim() : null
}

function tagAll(xml: string, name: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`,
    'gi'
  )
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim())
  return out
}

function hasTag(xml: string, name: string): boolean {
  return new RegExp(`<(?:[\\w.-]+:)?${name}[\\s>/]`, 'i').test(xml)
}

/** 探测 eSCL 扫描仪并解析能力 */
export async function probeScanner(esclUrl: string): Promise<ProbeResult> {
  const base = normalizeBase(esclUrl)
  let res: Response
  try {
    res = await fetchWithTimeout(`${base}/ScannerCapabilities`, { method: 'GET' }, 6000)
  } catch (e: any) {
    return {
      ok: false,
      msg: `无法连接扫描仪（${e?.name === 'AbortError' ? '超时' : e?.message || '网络错误'}），请检查 IP 与 8095 端口`,
    }
  }
  if (res.status === 404) {
    return { ok: false, msg: '设备可达但未开启 eSCL/AirScan 扫描服务（404）' }
  }
  if (!res.ok) {
    return { ok: false, msg: `扫描仪返回 HTTP ${res.status}` }
  }
  const xml = await res.text()

  const colorModes = Array.from(new Set(tagAll(xml, 'ColorMode'))).filter(Boolean)
  const resolutions = Array.from(
    new Set(tagAll(xml, 'Resolution').map(Number).filter((n) => n > 0 && n <= 1200))
  ).sort((a, b) => a - b)
  const maxW = Number(tag(xml, 'MaxWidth') || 2550) || 2550
  const maxH = Number(tag(xml, 'MaxHeight') || 3508) || 3508
  const name = tag(xml, 'MakeAndModel') || tag(xml, 'PrinterName') || 'eSCL 扫描仪'
  const platen = hasTag(xml, 'Platen')
  const adf = hasTag(xml, 'Adf') || hasTag(xml, 'Feeder')
  const duplex = /<(?:[\w.-]+:)?DuplexSupported[\s>/]/i.test(xml)

  return {
    ok: true,
    msg: `扫描仪连通正常（${name}）`,
    caps: {
      name,
      platen,
      adf,
      duplex,
      colorModes: colorModes.length ? colorModes : ['RGB24'],
      resolutions: resolutions.length ? resolutions : [200, 300],
      maxW,
      maxH,
    },
  }
}

function buildScanSettings(
  opts: ScanOpts,
  caps: ScannerCaps,
  withFormat: boolean
): string {
  const source = opts.source === 'Feeder' && caps.adf ? 'Feeder' : 'Platen'
  const colorMode = caps.colorModes.includes(opts.colorMode) ? opts.colorMode : caps.colorModes[0]
  const dpi = caps.resolutions.includes(opts.dpi) ? opts.dpi : caps.resolutions[caps.resolutions.length - 1] || 200
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwgt.org/namespaces/0/9">
<pwg:Version>2.0</pwg:Version>
<scan:Intent>TextAndGraphic</scan:Intent>${withFormat ? '\n<scan:DocumentFormat>image/jpeg</scan:DocumentFormat>' : ''}
<pwg:ScanRegions>
<pwg:ScanRegion>
<pwg:Height>${caps.maxH}</pwg:Height>
<pwg:Width>${caps.maxW}</pwg:Width>
<pwg:XOffset>0</pwg:XOffset>
<pwg:YOffset>0</pwg:YOffset>
</pwg:ScanRegion>
</pwg:ScanRegions>
<pwg:InputSource>${source}</pwg:InputSource>
<pwg:ColorMode>${colorMode}</pwg:ColorMode>
<pwg:XResolution>${dpi}</pwg:XResolution>
<pwg:YResolution>${dpi}</pwg:YResolution>
</scan:ScanSettings>`
}

/**
 * 执行 eSCL 扫描：下发任务并逐页取回 JPEG。
 * Feeder（送稿器）模式自动连续取页直至 404（无更多纸张）。
 */
export async function scanPages(esclUrl: string, opts: ScanOpts): Promise<ScanResult> {
  const probe = await probeScanner(esclUrl)
  if (!probe.ok || !probe.caps) {
    return { ok: false, msg: probe.msg, pages: [] }
  }
  const caps = probe.caps
  const base = normalizeBase(esclUrl)

  // 下发扫描任务（优先声明 JPEG；部分严格机型不认识 DocumentFormat 则去掉重试）
  let res = await fetchWithTimeout(
    `${base}/ScanJobs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: buildScanSettings(opts, caps, true),
    },
    15000
  )
  if (res.status === 400 || res.status === 415 || res.status === 500) {
    res = await fetchWithTimeout(
      `${base}/ScanJobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: buildScanSettings(opts, caps, false),
      },
      15000
    )
  }
  if (!res.ok && res.status !== 201 && res.status !== 200) {
    return { ok: false, msg: `扫描仪拒绝任务（HTTP ${res.status}）`, pages: [] }
  }
  const loc = res.headers.get('Location')
  if (!loc) {
    return { ok: false, msg: '扫描仪未返回任务地址', pages: [] }
  }
  const jobUrl = new URL(loc, base).toString()

  const pages: ScanPageResult[] = []
  const maxPages = opts.source === 'Feeder' ? 50 : 1

  try {
    for (let p = 0; p < maxPages; p++) {
      let got = false
      let noMore = false
      // 单页最多等待 ~25s（扫描头预热/走纸）
      for (let attempt = 0; attempt < 30; attempt++) {
        let r: Response
        try {
          r = await fetchWithTimeout(`${jobUrl}/NextDocument`, { method: 'GET' }, 20000)
        } catch (e: any) {
          if (attempt >= 25) throw new Error(`取页超时：${e?.message || e}`)
          await sleep(800)
          continue
        }
        if (r.status === 200) {
          const ct = r.headers.get('content-type') || 'image/jpeg'
          if (/pdf/i.test(ct)) {
            throw new Error('扫描仪返回了 PDF 格式，请在设置中确认设备支持 JPEG 输出')
          }
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length < 100) throw new Error('扫描返回内容为空')
          pages.push({ buffer: buf, contentType: ct })
          got = true
          break
        }
        if (r.status === 404 || r.status === 410) {
          noMore = true
          break
        }
        // 503/502/409：任务预热中，稍后重试
        if (r.status === 503 || r.status === 502 || r.status === 409) {
          await sleep(800)
          continue
        }
        // 其他状态码
        if (pages.length > 0) {
          noMore = true
          break
        }
        throw new Error(`取页失败（HTTP ${r.status}）`)
      }
      if (noMore) break
      if (!got) break
    }
  } finally {
    // 清理任务（忽略错误）
    fetchWithTimeout(jobUrl, { method: 'DELETE' }, 5000).catch(() => {})
  }

  if (pages.length === 0) {
    return { ok: false, msg: '未扫描到任何页面，请确认放纸后重试', pages: [] }
  }
  return { ok: true, msg: `成功扫描 ${pages.length} 页`, pages }
}
