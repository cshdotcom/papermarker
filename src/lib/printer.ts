import fs from 'fs'
import ipp from 'ipp'

export interface PrintOptions {
  ippUrl: string
  jobName: string
  duplex: boolean
  copies: number
}

export interface PrintResult {
  success: boolean
  msg: string
}

function parseIppUrl(ipOrUrl: string): { url: string; host: string } {
  let url = ipOrUrl
  let host = ipOrUrl
  try {
    if (!/^https?:\/\//.test(ipOrUrl)) {
      // 纯 IP 或 host:port
      const parts = ipOrUrl.split(':')
      host = parts[0]
      url = `http://${ipOrUrl}:631/ipp/print`.replace(':631:631', ':631')
      if (!/:631\//.test(url) && parts.length === 1) {
        url = `http://${ipOrUrl}:631/ipp/print`
      }
    } else {
      const u = new URL(ipOrUrl)
      host = u.hostname
      url = ipOrUrl
    }
  } catch {
    url = `http://${ipOrUrl}:631/ipp/print`
    host = ipOrUrl
  }
  return { url, host }
}

/**
 * 通过 IPP 协议向局域网打印机（佳能 / 兄弟 / 惠普等现代网络打印机）
 * 发送打印任务。端口默认 631，跨平台通用，无需厂商驱动。
 */
export async function printPdfFile(
  pdfFilePath: string,
  opt: PrintOptions
): Promise<PrintResult> {
  if (!fs.existsSync(pdfFilePath)) {
    return { success: false, msg: 'PDF 文件不存在' }
  }

  const { url } = parseIppUrl(opt.ippUrl)
  let printer: any
  try {
    printer = ipp.Printer(url, { version: '2.0' })
  } catch (e: any) {
    return { success: false, msg: `IPP 初始化失败: ${e.message}` }
  }

  const pdfBuffer = fs.readFileSync(pdfFilePath)

  return new Promise<PrintResult>((resolve) => {
    let settled = false
    const done = (r: PrintResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    // 8 秒超时兜底，防止跨网段/防火墙导致挂死
    const timer = setTimeout(() => {
      done({ success: false, msg: 'IPP 连接超时（8s），请检查打印机 IP 与局域网' })
    }, 8000)

    try {
      const msg = {
        'operation-attributes-tag': {
          'requesting-user-name': 'PaperMarker',
          'job-name': opt.jobName,
          'document-format': 'application/pdf',
        },
        'job-attributes-tag': {
          copies: opt.copies,
          sides: opt.duplex ? 'two-sided-long-edge' : 'one-sided',
        },
        data: pdfBuffer,
      }
      printer.execute('Print-Job', msg, (err: any, res: any) => {
        clearTimeout(timer)
        if (err) {
          return done({ success: false, msg: `IPP 连接失败: ${err.message || err}` })
        }
        const code = res?.statusCode ?? -1
        // IPP 成功状态码为 0 (successful-ok) 或低值
        if (code === 0 || (code > 0 && code < 0x0400)) {
          return done({ success: true, msg: '打印任务已下发到打印机' })
        }
        return done({ success: false, msg: `打印机返回错误码: ${code}` })
      })
    } catch (e: any) {
      clearTimeout(timer)
      done({ success: false, msg: `IPP 调用异常: ${e.message}` })
    }
  })
}

/** 探测局域网 IPP 打印机是否可达 */
export async function probePrinter(ipOrUrl: string): Promise<{ ok: boolean; msg: string }> {
  const { url } = parseIppUrl(ipOrUrl)
  let printer: any
  try {
    printer = ipp.Printer(url, { version: '2.0' })
  } catch (e: any) {
    return { ok: false, msg: `IPP 初始化失败: ${e.message}` }
  }

  return new Promise((resolve) => {
    let settled = false
    const done = (r: { ok: boolean; msg: string }) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const timer = setTimeout(() => {
      done({ ok: false, msg: '探测超时（6s），无法连接到打印机' })
    }, 6000)

    try {
      printer.execute('Get-Printer-Attributes', { 'operation-attributes-tag': {} }, (err: any, res: any) => {
        clearTimeout(timer)
        if (err) {
          return done({ ok: false, msg: `无法连接: ${err.message || err}` })
        }
        const attrs = res?.['printer-attributes-tag'] || {}
        const name =
          attrs['printer-name'] || attrs.printerName || attrs['printer-info'] || 'IPP 可用'
        return done({
          ok: true,
          msg: `打印机连通正常（${typeof name === 'string' ? name : 'IPP 可用'}）`,
        })
      })
    } catch (e: any) {
      clearTimeout(timer)
      done({ ok: false, msg: `探测异常: ${e.message}` })
    }
  })
}
