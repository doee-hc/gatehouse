export const MAX_SESSION_SNAPSHOT_LINES = 50
export const DEFAULT_SESSION_SNAPSHOT_LINES = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function clampSnapshotLines(lines: number | undefined) {
  if (lines === undefined) return DEFAULT_SESSION_SNAPSHOT_LINES
  if (!Number.isFinite(lines) || lines < 1) return 1
  return Math.min(Math.floor(lines), MAX_SESSION_SNAPSHOT_LINES)
}

export function collectSessionActivityLines(messages: Record<string, unknown>[]) {
  const lines: string[] = []
  for (const row of messages) {
    const info = isRecord(row.info) ? row.info : row
    const role = typeof info.role === "string" ? info.role : "unknown"
    const parts = Array.isArray(row.parts) ? row.parts : []
    for (const part of parts) {
      if (!isRecord(part)) continue
      if (part.type === "text" && typeof part.text === "string") {
        for (const line of part.text.split("\n")) {
          const trimmed = line.trimEnd()
          if (trimmed) lines.push(`${role}: ${trimmed}`)
        }
      }
      if (part.type === "tool") {
        const tool = typeof part.tool === "string" ? part.tool : "tool"
        const state = isRecord(part.state) ? part.state : {}
        const status = typeof state.status === "string" ? state.status : "unknown"
        lines.push(`${role}: [tool ${tool} ${status}]`)
      }
    }
  }
  return lines
}

export function tailSessionSnapshotLines(messages: Record<string, unknown>[], maxLines: number) {
  return collectSessionActivityLines(messages).slice(-maxLines)
}

export function snapshotHasRunningTool(tailLines: string[]) {
  return tailLines.some((line) => /\[tool [^\]]+ running\]/.test(line))
}
