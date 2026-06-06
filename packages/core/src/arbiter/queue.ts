import path from "node:path"
import type { InspectorDecisionRecord, PermissionCase } from "./types.ts"

export class PermissionQueue {
  private pending = new Map<string, PermissionCase>()

  constructor(private directory: string) {}

  upsert(item: PermissionCase) {
    this.pending.set(item.requestId, item)
  }

  remove(requestId: string) {
    this.pending.delete(requestId)
  }

  get(requestId: string) {
    return this.pending.get(requestId)
  }

  list() {
    return [...this.pending.values()].sort((a, b) => a.requestId.localeCompare(b.requestId))
  }

  clear() {
    this.pending.clear()
  }

  async appendDecision(record: InspectorDecisionRecord) {
    const dir = path.join(this.directory, ".gatehouse", "arbiter")
    await Bun.$`mkdir -p ${dir}`.quiet()
    const line = `${JSON.stringify(record)}\n`
    const file = Bun.file(path.join(dir, "decisions.jsonl"))
    const previous = (await file.exists()) ? await file.text() : ""
    await Bun.write(file, previous + line)
  }
}

export function permissionCaseFromEvent(properties: Record<string, unknown>): PermissionCase | undefined {
  if (typeof properties.id !== "string") return
  if (typeof properties.sessionID !== "string") return
  if (typeof properties.permission !== "string") return
  const patterns = Array.isArray(properties.patterns)
    ? properties.patterns.filter((item): item is string => typeof item === "string")
    : []
  const metadata =
    typeof properties.metadata === "object" && properties.metadata !== null
      ? (properties.metadata as Record<string, unknown>)
      : {}
  const always = Array.isArray(properties.always)
    ? properties.always.filter((item): item is string => typeof item === "string")
    : []
  const tool =
    typeof properties.tool === "object" && properties.tool !== null
      ? {
          messageID:
            typeof (properties.tool as Record<string, unknown>).messageID === "string"
              ? ((properties.tool as Record<string, unknown>).messageID as string)
              : "",
          callID:
            typeof (properties.tool as Record<string, unknown>).callID === "string"
              ? ((properties.tool as Record<string, unknown>).callID as string)
              : "",
        }
      : undefined
  return {
    requestId: properties.id,
    sessionId: properties.sessionID,
    permission: properties.permission,
    patterns,
    metadata,
    always,
    ...(tool?.messageID && tool.callID ? { tool } : {}),
    askedAt: new Date().toISOString(),
  }
}
