import { mkdir } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export function resolveAttachmentsDir(projectDir: string) {
  return path.join(projectDir, ".gatehouse", "channels", "attachments")
}

export function sanitizeFilename(raw: string) {
  let name = raw
    .replace(/[/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
  if (!name) name = "file"
  const maxNameLen = 200
  if (name.length > maxNameLen) {
    const dotIdx = name.lastIndexOf(".")
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ""
    name = name.slice(0, maxNameLen - ext.length) + ext
  }
  return `${Date.now()}-${randomBytes(2).toString("hex")}-${name}`
}

export function mimeFromContentType(contentType: string | null | undefined, fallback = "application/octet-stream") {
  if (!contentType) return fallback
  const base = contentType.split(";")[0]?.trim()
  return base || fallback
}

export function mimeFromFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".svg") return "image/svg+xml"
  return "application/octet-stream"
}

export async function saveAttachment(projectDir: string, filename: string, data: Uint8Array) {
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 限制`)
  }
  const dir = resolveAttachmentsDir(projectDir)
  await mkdir(dir, { recursive: true })
  const safeName = sanitizeFilename(filename)
  const filepath = path.join(dir, safeName)
  if (!path.resolve(filepath).startsWith(path.resolve(dir))) {
    throw new Error("附件路径无效")
  }
  await Bun.write(filepath, data)
  return filepath
}

export async function downloadUrlAttachment(projectDir: string, url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`)
  }
  const contentLength = response.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 限制`)
  }
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 限制`)
  }
  const mime = mimeFromContentType(response.headers.get("content-type"), mimeFromFilename(filename))
  const filepath = await saveAttachment(projectDir, filename, data)
  return { filepath, mime }
}
