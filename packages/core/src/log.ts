import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "./paths.ts"
import { appendTuiNotification } from "./tui/notifications.ts"

export type GatehouseLogLevel = "info" | "warn" | "error"

export type GatehouseLogContext = {
  projectDirectory?: string
  title?: string
  /** When true, warn/error also surface as OpenCode TUI toasts (default: off). */
  tui?: boolean
}

type GatehouseLogMode = "quiet" | "verbose" | "file"

const DEDUP_MS = 30_000
const recentNotifications = new Map<string, number>()

function resolveLogMode(): GatehouseLogMode {
  const mode = process.env.GATEHOUSE_LOG?.trim().toLowerCase()
  if (mode === "verbose" || mode === "quiet") return mode
  return "file"
}

function resolveProjectDirectory(context?: GatehouseLogContext) {
  const fromContext = context?.projectDirectory?.trim()
  if (fromContext) return fromContext
  const fromEnv = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (fromEnv) return fromEnv
  return undefined
}

function gatehouseLogFile(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "logs", "gatehouse.log")
}

function appendLogFile(projectDirectory: string, level: GatehouseLogLevel, message: string) {
  const file = gatehouseLogFile(projectDirectory)
  const dir = path.dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`, "utf8")
}

function shouldNotify(level: GatehouseLogLevel, message: string) {
  const key = `${level}:${message}`
  const now = Date.now()
  const last = recentNotifications.get(key)
  if (last && now - last < DEDUP_MS) return false
  recentNotifications.set(key, now)
  return true
}

function defaultTitle(level: GatehouseLogLevel, context?: GatehouseLogContext) {
  if (context?.title?.trim()) return context.title.trim()
  return level === "error" ? "Gatehouse" : "Gatehouse"
}

function writeConsole(level: GatehouseLogLevel, message: string) {
  if (level === "info") console.log(message)
  else if (level === "warn") console.warn(message)
  else console.error(message)
}

export function gatehouseLog(level: GatehouseLogLevel, message: string, context?: GatehouseLogContext) {
  const projectDirectory = resolveProjectDirectory(context)
  const mode = resolveLogMode()

  if (projectDirectory) {
    appendLogFile(projectDirectory, level, message)
  }

  if (
    context?.tui === true &&
    projectDirectory &&
    (level === "warn" || level === "error") &&
    shouldNotify(level, message)
  ) {
    appendTuiNotification(projectDirectory, {
      level,
      title: defaultTitle(level, context),
      message,
    })
  }

  if (mode === "verbose") writeConsole(level, message)
}

export function createProjectLogger(projectDirectory: string, title = "Gatehouse") {
  const directory = projectDirectory.trim()
  return {
    info: (message: string) => gatehouseLog("info", message, { projectDirectory: directory, title }),
    warn: (message: string) => gatehouseLog("warn", message, { projectDirectory: directory, title }),
    error: (message: string) => gatehouseLog("error", message, { projectDirectory: directory, title }),
  }
}
