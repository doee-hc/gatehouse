import path from "node:path"
import { RegistryDatabase } from "../registry/db.ts"
import { activePortalMissionIds, parseMissionsFile } from "../missions/parse.ts"
import { leadDir } from "../paths.ts"
import { readManifest } from "../tree/store.ts"
import { classifyToolActivity, portalAgentStatus } from "./activity.ts"
import { deliverPortalEvent } from "./events.ts"
import { spawnIdForAgent } from "./spawn-id.ts"

export type AgentLiveStatus = "idle" | "busy" | "research"

/** Ignore idle shorter than this between tool calls (e.g. two send_message in one turn). */
const IDLE_SETTLE_MS = 400

const projects = new Map<string, ProjectAgentSync>()

export function agentSync(projectDirectory: string) {
  const key = path.resolve(projectDirectory)
  const existing = projects.get(key)
  if (existing) return existing
  const created = new ProjectAgentSync(key)
  projects.set(key, created)
  return created
}

export function resetAgentSyncForTests() {
  for (const sync of projects.values()) sync.clearPendingTimers()
  projects.clear()
}

class ProjectAgentSync {
  readonly sessionToSpawn = new Map<string, string>()
  readonly aliasToSpawn = new Map<string, string>()
  readonly liveBySpawn = new Map<string, AgentLiveStatus>()
  readonly lastToolBySession = new Map<string, string>()
  private parentBySession = new Map<string, string>()
  private idleSettleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(readonly projectDirectory: string) {}

  clearPendingTimers() {
    for (const timer of this.idleSettleTimers.values()) clearTimeout(timer)
    this.idleSettleTimers.clear()
  }

  async refreshIndex(opencodeUrl?: string) {
    const missionsDoc = await readMissionsDocument(this.projectDirectory)
    const portalSet = new Set(activePortalMissionIds(missionsDoc))
    const registry = new RegistryDatabase(this.projectDirectory, { readonly: true })
    const agents = registry
      .load()
      .agents.filter((agent) => agent.status === "active")
      .filter((agent) => agent.scope === "outer" || (agent.missionId && portalSet.has(agent.missionId)))

    this.sessionToSpawn.clear()
    for (const agent of agents) {
      this.sessionToSpawn.set(agent.sessionId, spawnIdForAgent(agent))
    }

    const activeMissionId = activePortalMissionIds(missionsDoc)[0]
    if (activeMissionId) {
      const manifest = await readManifest(this.projectDirectory, activeMissionId)
      if (manifest) {
        for (const [nodeId, node] of Object.entries(manifest.nodes)) {
          this.sessionToSpawn.set(node.session_id, nodeId.replace(/[^a-zA-Z0-9_-]/g, "-"))
        }
      }
    }

    if (opencodeUrl) await this.refreshSessionParents(opencodeUrl)
  }

  spawnForSession(sessionId: string) {
    return this.sessionToSpawn.get(sessionId) ?? this.aliasToSpawn.get(sessionId)
  }

  liveStatus(spawnId: string) {
    return this.liveBySpawn.get(spawnId)
  }

  resolveSnapshotStatus(
    spawnId: string,
    sessionId: string,
    sessionStatus: Record<string, string>,
    opencodeReachable: boolean,
  ): AgentLiveStatus {
    if (opencodeReachable) {
      if (!Object.prototype.hasOwnProperty.call(sessionStatus, sessionId)) return "idle"
      return portalAgentStatus({
        sessionStatus: sessionStatus[sessionId],
        lastTool: this.lastToolBySession.get(sessionId),
      })
    }
    return this.liveBySpawn.get(spawnId) ?? "idle"
  }

  async handleOpencodeEvent(event: unknown, opencodeUrl?: string) {
    const update = readAgentStatusUpdate(event)
    if (!update) return

    const spawnId = await this.resolveSpawnId(update.sessionId, opencodeUrl)
    if (!spawnId) return

    this.publishStatus(spawnId, update.status)
  }

  private publishStatus(spawnId: string, status: AgentLiveStatus) {
    if (status !== "idle") {
      const pending = this.idleSettleTimers.get(spawnId)
      if (pending) {
        clearTimeout(pending)
        this.idleSettleTimers.delete(spawnId)
      }
      if (this.liveBySpawn.get(spawnId) === status) return
      this.liveBySpawn.set(spawnId, status)
      deliverPortalEvent({ type: "agent.status", agentId: spawnId, status })
      return
    }

    if (this.liveBySpawn.get(spawnId) === undefined) return
    if (this.idleSettleTimers.has(spawnId)) return

    this.idleSettleTimers.set(
      spawnId,
      setTimeout(() => {
        this.idleSettleTimers.delete(spawnId)
        if (this.liveBySpawn.get(spawnId) === undefined) return
        this.liveBySpawn.delete(spawnId)
        deliverPortalEvent({ type: "agent.status", agentId: spawnId, status: "idle" })
      }, IDLE_SETTLE_MS),
    )
  }

  private async resolveSpawnId(sessionId: string, opencodeUrl?: string) {
    const direct = this.spawnForSession(sessionId)
    if (direct) return direct

    if (!opencodeUrl) return undefined
    if (this.parentBySession.size === 0) await this.refreshSessionParents(opencodeUrl)

    let current = sessionId
    const seen = new Set<string>()
    while (!seen.has(current)) {
      seen.add(current)
      const parent = this.parentBySession.get(current)
      if (!parent) break
      const spawn = this.spawnForSession(parent)
      if (spawn) {
        this.aliasToSpawn.set(sessionId, spawn)
        return spawn
      }
      current = parent
    }
    return undefined
  }

  private async refreshSessionParents(opencodeUrl: string) {
    const url = new URL("/session", opencodeUrl)
    url.searchParams.set("directory", this.projectDirectory)
    const response = await fetch(url, {
      headers: { "x-opencode-directory": this.projectDirectory },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    if (!response?.ok) return
    const body = (await response.json()) as unknown
    const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.data) ? body.data : []
    this.parentBySession.clear()
    for (const entry of list) {
      if (!isRecord(entry)) continue
      if (typeof entry.id !== "string" || typeof entry.parentID !== "string") continue
      this.parentBySession.set(entry.id, entry.parentID)
    }
  }
}

async function readMissionsDocument(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) return parseMissionsFile("schema_version: 1\nmissions: []\n")
  return parseMissionsFile(await file.text())
}

function readAgentStatusUpdate(event: unknown) {
  if (!isRecord(event) || event.type !== "session.status") return undefined
  const properties = isRecord(event.properties) ? event.properties : undefined
  const sessionId = readString(properties, "sessionID")
  const raw = readStatusType(properties)
  if (!sessionId || !raw) return undefined
  if (raw === "idle") return { sessionId, status: "idle" as const }
  if (raw === "busy" || raw === "retry") return { sessionId, status: "busy" as const }
  return undefined
}

function readStatusType(properties: Record<string, unknown> | undefined) {
  if (!properties) return undefined
  const status = properties.status
  if (typeof status === "string") return status
  if (isRecord(status) && typeof status.type === "string") return status.type
  return undefined
}

function readString(record: unknown, key: string) {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
