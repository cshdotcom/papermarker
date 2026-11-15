'use client'

/**
 * 客户端 eSCL 网络扫描仪（浏览器直连，不经服务器）。
 *
 * 架构：应用部署在云端时，服务器无法访问用户局域网内的扫描仪。
 * 但浏览器与扫描仪在同一局域网，可以直接发 HTTP 请求。
 *
 * eSCL 协议（HTTP 8095）：
 *  1. GET  {base}/ScannerCapabilities  探测能力
 *  2. POST {base}/ScanJobs             下发扫描任务，返回 Location
 *  3. GET  {Location}/NextDocument     逐页取回 JPEG
 *  4. DELETE {Location}                清理任务
 *
 * CORS 限制：
 *  - Content-Type: text/xml 会触发预检（OPTIONS），多数打印机不支持
 *  - 改用 text/plain 避免预检（部分打印机接受）
 *  - 读取 JPEG 响应需要打印机返回 CORS 头（Access-Control-Allow-Origin）
 *  - 佳能 / 惠普 部分型号支持；兄弟 / 爱普生多数不支持
 *  - 不支持时 fetch 抛 TypeError → 提示用户改用相机或 APK
 */

export interface ClientScanOpts {
  source: string // Platen | Feeder
  colorMode: string // RGB24 | Grayscale8 | BlackAndWhite1
  dpi: number
}

export interface ClientScanPage {
  blob: Blob
  url: string // object URL for preview
  contentType: string
}

export interface ClientScanResult {
  ok: boolean
  msg: string
  pages: ClientScanPage[]
  needsCamera?: boolean // CORS 不支持时引导用相机
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function normalizeBase(url: string): string {
  let base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) base = `http://${base}`
  return base
}

/** 简单 XML 标签提取（不用 DOMParser，兼容性更好） */
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}[^>]*>([^<]*)</(?:[\\w.-]+:)?${name}>`, 'i'))
  return m ? m[1].trim() : ''
}
function tagAll(xml: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}[^>]*>([^<]*)</(?:[\\w.-]+:)?${name}>`, 'gi')
  let m
  while ((m = re.exec(xml))) out.push(m[1].trim())
  return out
}
function hasTag(xml: string, name: string): boolean {
  return new RegExp(`<(?:[\\w.-]+:)?${name}[\\s>/]`, 'i').test(xml)
}

/**
 * 客户端 eSCL 探测 + 扫描（浏览器直连）。
 * 需要打印机支持 CORS；不支持时返回 needsCamera=true。
 */
export async function clientEsclScan(
  esclUrl: string,
  opts: ClientScanOpts
): Promise<ClientScanResult> {
  const base = normalizeBase(esclUrl)

  // 1. 探测能力（同时验证 CORS 是否可用）
  let capsRes: Response
  try {
    capsRes = await fetchTimeout(`${base}/ScannerCapabilities`, { method: 'GET' }, 6000)
  } catch (e: any) {
    return {
      ok: false,
      msg: `浏览器无法连接扫描仪（${e?.message || '网络错误'}）。可能原因：IP/端口不对、设备未开机、或浏览器被 CORS 拦截。`,
      pages: [],
      needsCamera: true,
    }
  }

  // 如果 fetch 成功但 status=0（opaque），说明 CORS 没通过
  if (capsRes.type === 'opaque' || capsRes.status === 0) {
    return {
      ok: false,
      msg: '扫描仪不支持跨域访问（CORS），浏览器无法读取扫描结果。请改用手机相机拍照，或使用 Android 客户端（原生 TCP 不受限制）。',
      pages: [],
      needsCamera: true,
    }
  }

  if (!capsRes.ok) {
    return {
      ok: false,
      msg: `扫描仪返回 HTTP ${capsRes.status}，请确认 eSCL 服务已开启`,
      pages: [],
    }
  }

  // 读取能力 XML
  let capsXml: string
  try {
    capsXml = await capsRes.text()
  } catch {
    return {
      ok: false,
      msg: '无法读取扫描仪能力信息（CORS 限制），浏览器无法读取响应体。',
      pages: [],
      needsCamera: true,
    }
  }

  const colorModes = Array.from(new Set(tagAll(capsXml, 'ColorMode'))).filter(Boolean)
  const resolutions = Array.from(
    new Set(tagAll(capsXml, 'Resolution').map(Number).filter((n) => n > 0 && n <= 1200))
  ).sort((a, b) => a - b)
  const maxW = Number(tag(capsXml, 'MaxWidth') || 2550) || 2550
  const maxH = Number(tag(capsXml, 'MaxHeight') || 3508) || 3508
  const platen = hasTag(capsXml, 'Platen')
  const adf = hasTag(capsXml, 'Adf') || hasTag(capsXml, 'Feeder')

  // 2. 构建扫描设置 XML
  const source = opts.source === 'Feeder' && adf ? 'Feeder' : 'Platen'
  const colorMode = colorModes.includes(opts.colorMode) ? opts.colorMode : colorModes[0] || 'RGB24'
  const dpi = resolutions.includes(opts.dpi) ? opts.dpi : resolutions[resolutions.length - 1] || 200
  const settingsXml = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwgt.org/namespaces/0/9">
<pwg:Version>2.0</pwg:Version>
<scan:Intent>TextAndGraphic</scan:Intent>
<scan:DocumentFormat>image/jpeg</scan:DocumentFormat>
<pwg:ScanRegions><pwg:ScanRegion>
<pwg:Height>${maxH}</pwg:Height><pwg:Width>${maxW}</pwg:Width>
<pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset>
</pwg:ScanRegion></pwg:ScanRegions>
<pwg:InputSource>${source}</pwg:InputSource>
<pwg:ColorMode>${colorMode}</pwg:ColorMode>
<pwg:XResolution>${dpi}</pwg:XResolution>
<pwg:YResolution>${dpi}</pwg:YResolution>
</scan:ScanSettings>`

  // 3. 下发扫描任务
  //    Content-Type: text/xml 会触发 CORS 预检；改用 text/plain 尝试避免预检
  let jobRes: Response
  try {
    jobRes = await fetchTimeout(
      `${base}/ScanJobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: settingsXml,
      },
      15000
    )
  } catch (e: any) {
    return {
      ok: false,
      msg: `下发扫描任务失败：${e?.message || '网络错误'}`,
      pages: [],
      needsCamera: true,
    }
  }

  if (jobRes.type === 'opaque') {
    return {
      ok: false,
      msg: '扫描仪不支持 CORS，浏览器无法读取任务响应。请改用手机相机或 Android 客户端。',
      pages: [],
      needsCamera: true,
    }
  }

  if (!jobRes.ok && jobRes.status !== 201 && jobRes.status !== 200) {
    // 重试：用 application/x-www-form-urlencoded 内容类型
    try {
      jobRes = await fetchTimeout(
        `${base}/ScanJobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: settingsXml,
        },
        15000
      )
    } catch {}
  }

  if (!jobRes.ok && jobRes.status !== 201 && jobRes.status !== 200) {
    return {
      ok: false,
      msg: `扫描仪拒绝任务（HTTP ${jobRes.status}）`,
      pages: [],
    }
  }

  // 获取任务 URL（Location 头）
  const loc = jobRes.headers.get('Location') || jobRes.headers.get('location')
  if (!loc) {
    return { ok: false, msg: '扫描仪未返回任务地址（CORS 可能未暴露 Location 头）', pages: [], needsCamera: true }
  }
  const jobUrl = new URL(loc, base).toString()

  // 4. 逐页取回扫描结果
  const pages: ClientScanPage[] = []
  const maxPages = source === 'Feeder' ? 50 : 1

  try {
    for (let p = 0; p < maxPages; p++) {
      let got = false
      let noMore = false
      // 单页最多等待 ~25s
      for (let attempt = 0; attempt < 30; attempt++) {
        let r: Response
        try {
          r = await fetchTimeout(`${jobUrl}/NextDocument`, { method: 'GET' }, 20000)
        } catch (e: any) {
          if (attempt >= 25) throw new Error(`取页超时：${e?.message || e}`)
          await sleep(800)
          continue
        }
        if (r.status === 200 && r.type !== 'opaque') {
          const ct = r.headers.get('content-type') || 'image/jpeg'
          const blob = await r.blob()
          if (blob.size < 100) throw new Error('扫描返回内容为空')
          pages.push({ blob, url: URL.createObjectURL(blob), contentType: ct })
          got = true
          break
        }
        if (r.status === 404 || r.status === 410) {
          noMore = true
          break
        }
        if (r.status === 503 || r.status === 502 || r.status === 409) {
          await sleep(800)
          continue
        }
        if (pages.length > 0) {
          noMore = true
          break
        }
        if (attempt >= 25) throw new Error(`扫描仪返回 HTTP ${r.status}`)
        await sleep(800)
      }
      if (noMore) break
      if (!got && pages.length === 0) throw new Error('未获取到扫描结果')
    }
  } finally {
    // 清理任务
    try {
      await fetchTimeout(jobUrl, { method: 'DELETE' }, 3000)
    } catch {}
  }

  if (pages.length === 0) {
    return { ok: false, msg: '扫描完成但未获取到页面', pages: [] }
  }

  return {
    ok: true,
    msg: `扫描完成，共 ${pages.length} 页（${source === 'Feeder' ? '送稿器' : '平板'} · ${dpi}dpi）`,
    pages,
  }
}
