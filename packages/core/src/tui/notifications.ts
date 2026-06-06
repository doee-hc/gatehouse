import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "../paths.ts"

export type TuiNotificationLevel = "warn" | "error"

export type TuiNotification = {
  id: string
  level: TuiNotificationLevel
  title: string
  message: string
  at: string
}

function tuiNotificationPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "tui-notifications.jsonl")
}

function ensureGatehouseDir(projectDirectory: string) {
  const dir = gatehouseRoot(projectDirectory)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function appendTuiNotification(
  projectDirectory: string,
  input: Pick<TuiNotification, "level" | "title" | "message">,
) {
  const directory = projectDirectory.trim()
  if (!directory) return
  ensureGatehouseDir(directory)
  const entry: TuiNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    level: input.level,
    title: input.title,
    message: input.message,
    at: new Date().toISOString(),
  }
  appendFileSync(tuiNotificationPath(directory), `${JSON.stringify(entry)}\n`, "utf8")
}

export function readTuiNotificationsFromOffset(projectDirectory: string, offset = 0) {
  const file = tuiNotificationPath(projectDirectory)
  if (!existsSync(file)) return { notifications: [] as TuiNotification[], nextOffset: 0 }

  const raw = readFileSync(file, "utf8")
  const slice = raw.slice(offset)
  const notifications: TuiNotification[] = []

  for (const line of slice.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as TuiNotification).id === "string" &&
        typeof (parsed as TuiNotification).message === "string" &&
        ((parsed as TuiNotification).level === "warn" || (parsed as TuiNotification).level === "error")
      ) {
        notifications.push(parsed as TuiNotification)
      }
    } catch {
      // skip malformed lines
    }
  }

  return { notifications, nextOffset: raw.length }
}

/** Byte offset at end of the notification file — use to skip history on TUI startup. */
export function tuiNotificationFileEndOffset(projectDirectory: string) {
  return readTuiNotificationsFromOffset(projectDirectory, 0).nextOffset
}
