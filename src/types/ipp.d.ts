declare module 'ipp' {
  interface IppRequestData {
    operation?: string
    'operation-attributes-tag'?: Record<string, any>
    'job-attributes-tag'?: Record<string, any>
    data?: Buffer
    [key: string]: any
  }
  interface IppResponse {
    statusCode?: number
    'printer-attributes-tag'?: Record<string, any>
    [key: string]: any
  }
  type IppCallback = (err: Error | null, response: IppResponse) => void
  interface Printer {
    execute(operation: string, msg: IppRequestData, cb: IppCallback): void
    url: any
    version: string
    uri: string
    charset: string
    language: string
  }
  interface PrinterConstructor {
    new (url: string, opts?: { version?: string; uri?: string; charset?: string; language?: string }): Printer
    (url: string, opts?: { version?: string }): Printer
  }
  const ipp: {
    request(url: string, data: Buffer, callback: IppCallback): void
    Printer: PrinterConstructor
    serialize: (msg: any) => Buffer
    parse: (buf: Buffer) => any
  }
  export default ipp
}
