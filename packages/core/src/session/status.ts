import type { PluginInput } from "@opencode-ai/plugin"
import { directoryQuery, type GatehouseClient } from "./client.ts"
import { opencodeHttpReady, sessionStatusMapHttp } from "./http.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export type SessionRuntimeStatus = "idle" | "busy" | "retry" | "unknown"

/** OpenCode session.status lists only busy/retry entries; absent session IDs are idle. */
export async function sessionStatusById(
  client: GatehouseClient,
  directory: string,
  plugin?: PluginInput,
): Promise<Map<string, SessionRuntimeStatus> | null> {
  if (plugin && (await opencodeHttpReady(plugin))) {
    try {
      return await sessionStatusMapHttp(plugin)
    } catch {
      // Fall back to SDK when the HTTP route fails mid-flight.
    }
  }
  if (typeof client.session.status !== "function") return null
  const response = await client.session.status({ ...directoryQuery(directory) }).catch(() => undefined)
  const data = isRecord(response) && isRecord(response.data) ? response.data : response
  if (!isRecord(data)) return null
  return new Map(
    Object.entries(data).map(([sessionId, value]) => {
      const type = isRecord(value) && typeof value.type === "string" ? value.type : "unknown"
      if (type === "idle" || type === "busy" || type === "retry") return [sessionId, type] as const
      return [sessionId, "unknown"] as const
    }),
  )
}

export function sessionRuntimeStatus(map: Map<string, SessionRuntimeStatus>, sessionId: string): SessionRuntimeStatus {
  const status = map.get(sessionId)
  if (status === undefined) return "idle"
  return status
}
