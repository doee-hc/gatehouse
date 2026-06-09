import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { mimeFromFilename } from "./attachments.ts"

export type OutboundAttachment = {
  path: string
  mime: string
  filename: string
  created_at: number
}

export function resolveOutboundDir(projectDir: string) {
  return path.join(projectDir, ".gatehouse", "channels", "outbound")
}

export function outboundQueuePath(projectDir: string, sessionId: string) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_")
  return path.join(resolveOutboundDir(projectDir), `${safeId}.json`)
}

export function resolveOutboundPath(projectDir: string, inputPath: string) {
  const projectRoot = path.resolve(projectDir)
  const resolved = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(projectRoot, inputPath)
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    throw new Error("路径必须在 Gatehouse 项目目录内")
  }
  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseQueue(data: unknown): OutboundAttachment[] {
  if (!isRecord(data) || !Array.isArray(data.items)) return []
  return data.items.flatMap((item): OutboundAttachment[] => {
    if (!isRecord(item)) return []
    const filePath = typeof item.path === "string" ? item.path.trim() : ""
    if (!filePath) return []
    const filename =
      (typeof item.filename === "string" && item.filename.trim()) || path.basename(filePath)
    const mime =
      (typeof item.mime === "string" && item.mime.trim()) || mimeFromFilename(filename)
    const createdAt = typeof item.created_at === "number" ? item.created_at : Date.now()
    return [{ path: filePath, mime, filename, created_at: createdAt }]
  })
}

export async function readOutboundQueue(projectDir: string, sessionId: string) {
  const queuePath = outboundQueuePath(projectDir, sessionId)
  if (!(await Bun.file(queuePath).exists())) return []
  try {
    return parseQueue(await Bun.file(queuePath).json())
  } catch {
    return []
  }
}

export async function enqueueOutboundFile(
  projectDir: string,
  sessionId: string,
  input: { path: string; mime?: string; filename?: string },
) {
  const absolutePath = resolveOutboundPath(projectDir, input.path)
  if (!(await Bun.file(absolutePath).exists())) {
    throw new Error(`文件不存在: ${absolutePath}`)
  }
  const filename = input.filename?.trim() || path.basename(absolutePath)
  const mime = input.mime?.trim() || mimeFromFilename(filename)
  const item: OutboundAttachment = {
    path: absolutePath,
    mime,
    filename,
    created_at: Date.now(),
  }
  const queuePath = outboundQueuePath(projectDir, sessionId)
  await mkdir(path.dirname(queuePath), { recursive: true })
  const items = await readOutboundQueue(projectDir, sessionId)
  items.push(item)
  await Bun.write(queuePath, `${JSON.stringify({ session_id: sessionId, items }, null, 2)}\n`)
  return item
}

export async function consumeOutboundQueue(projectDir: string, sessionId: string) {
  const items = await readOutboundQueue(projectDir, sessionId)
  const queuePath = outboundQueuePath(projectDir, sessionId)
  if (await Bun.file(queuePath).exists()) {
    await rm(queuePath, { force: true })
  }
  return items
}

export function isImageAttachment(item: OutboundAttachment) {
  return item.mime.startsWith("image/")
}
