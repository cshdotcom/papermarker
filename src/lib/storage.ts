import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), 'storage')

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

export function uploadDir(): string {
  const d = path.join(STORAGE_ROOT, 'upload')
  ensureDir(d)
  return d
}

export function processedDir(): string {
  const d = path.join(STORAGE_ROOT, 'processed')
  ensureDir(d)
  return d
}

export function pdfDir(): string {
  const d = path.join(STORAGE_ROOT, 'pdf')
  ensureDir(d)
  return d
}

export function genFilename(ext: string): string {
  return uuidv4() + ext
}

/** 返回相对 STORAGE_ROOT 的路径，用于稳定存储与读取 */
export function relPath(absPath: string): string {
  return path.relative(STORAGE_ROOT, absPath)
}

export function absPath(rel: string): string {
  return path.join(STORAGE_ROOT, rel)
}

export function ensureStorageDirs() {
  ensureDir(STORAGE_ROOT)
  uploadDir()
  processedDir()
  pdfDir()
}
