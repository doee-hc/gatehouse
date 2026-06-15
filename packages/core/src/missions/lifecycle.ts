import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { readMissionsDocument, writeMissionsDocument } from "./store.ts"
import type { MissionsDocument } from "./parse.ts"
import { readManifest, readRetroManifest, readTreesIndex, upsertTreesIndex, writeManifest } from "../tree/store.ts"
import type { ExtractManifest, RetroManifest, TreeManifest, VerifyManifest } from "../tree/types.ts"
import { getRegistryStore } from "../registry/context.ts"
import type { RegistryStore } from "../registry/store.ts"
import { LEAD_OPENCODE, type RegistryScope } from "../registry/types.ts"
import {
  deactivateInnerAgentsForMissions,
  deactivateRetroAgentsForMissions,
  deactivateExtractAgentsForMissions,
  deactivateVerifyAgentsForMissions,
} from "../registry/mission-agents.ts"
import { abortSessionHttp, opencodeHttpReady } from "../session/http.ts"
import { deleteSession, shouldRetainInnerSessions, type GatehouseClient } from "../session/client.ts"
import { sessionStatusById, sessionRuntimeStatus } from "../session/status.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"

export type MissionTerminalStatus = "done" | "cancelled"

export function findMission(doc: MissionsDocument, missionId: string) {
  return doc.missions.find((entry) => entry.id === missionId)
}

export function requireMission(doc: MissionsDocument, missionId: string) {
  const mission = findMission(doc, missionId)
  if (!mission) throw new Error(`Mission not found in missions.yaml: ${missionId}`)
  return mission
}

export async function requireLeadCaller(input: PluginInput, context: ToolContext) {
  if (context.agent !== LEAD_OPENCODE) return undefined

  const registry = await getRegistryStore(input)
  const registeredLead = registry.byProfile("lead", "outer")
  if (registeredLead && registeredLead.sessionId !== context.sessionID) return undefined

  const sender = registry.bySession(context.sessionID)
  if (sender && (sender.scope !== "outer" || sender.profile !== "lead")) return undefined

  return { registry, sender: sender ?? registeredLead }
}

export function collectManifestSessionIds(
  manifest: TreeManifest,
  retro?: RetroManifest,
  extract?: ExtractManifest,
  verify?: VerifyManifest,
) {
  const ids = new Set<string>()
  for (const node of Object.values(manifest.nodes)) ids.add(node.session_id)
  if (retro) {
    for (const node of Object.values(retro.nodes)) {
      ids.add(node.exec_session_id)
      ids.add(node.retro_session_id)
    }
  }
  if (extract) {
    for (const node of Object.values(extract.nodes)) ids.add(node.extract_session_id)
  }
  if (verify) {
    for (const node of Object.values(verify.nodes)) ids.add(node.verify_session_id)
  }
  return [...ids]
}

function agentsForIdleCheck(registry: RegistryStore, missionId: string, scopes: RegistryScope[]) {
  return scopes.flatMap((scope) => registry.list({ scope, missionId }))
}

export type MissionAgentsIdleBlocked = { agentId: string; sessionId: string; reason: string }

export type MissionAgentsIdleCheck =
  | {
      ok: true
      agents: ReturnType<typeof agentsForIdleCheck>
      statusMap: Map<string, import("../session/status.ts").SessionRuntimeStatus>
    }
  | { ok: false; kind: "no_agents"; message: string }
  | { ok: false; kind: "status_unavailable"; message: string }
  | { ok: false; kind: "not_idle"; blocked: MissionAgentsIdleBlocked[]; message: string }

const DEFAULT_RETRO_IDLE_WAIT_MS = 30_000
const DEFAULT_RETRO_IDLE_POLL_MS = 250

function defaultIdleWaitTimeoutMs() {
  const fromEnv = process.env.GATEHOUSE_MISSION_IDLE_WAIT_MS
  if (fromEnv) {
    const parsed = Number(fromEnv)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return DEFAULT_RETRO_IDLE_WAIT_MS
}

function formatMissionAgentsIdleError(blocked: MissionAgentsIdleBlocked[]) {
  return `All mission agents must be idle before proceeding: ${blocked.map((item) => `${item.agentId} (${item.reason})`).join("; ")}`
}

export async function checkMissionAgentsIdle(input: {
  registry: RegistryStore
  client: PluginInput["client"]
  directory: string
  plugin: PluginInput
  missionId: string
  scopes: RegistryScope[]
}): Promise<MissionAgentsIdleCheck> {
  const agents = agentsForIdleCheck(input.registry, input.missionId, input.scopes)
  if (agents.length === 0) {
    return {
      ok: false,
      kind: "no_agents",
      message: `No registry agents for mission ${input.missionId} (scopes: ${input.scopes.join(", ")})`,
    }
  }
  const statusMap = await sessionStatusById(input.client, input.directory, input.plugin)
  if (!statusMap) {
    return {
      ok: false,
      kind: "status_unavailable",
      message: "Session status unavailable; cannot verify mission agents are idle",
    }
  }
  const blocked: MissionAgentsIdleBlocked[] = []
  for (const agent of agents) {
    const runtime = sessionRuntimeStatus(statusMap, agent.sessionId)
    if (runtime !== "idle") {
      blocked.push({ agentId: agent.agentId, sessionId: agent.sessionId, reason: `session ${runtime}` })
      continue
    }
    if (input.registry.pendingDeliveryCountForSession(agent.sessionId) > 0) {
      blocked.push({ agentId: agent.agentId, sessionId: agent.sessionId, reason: "pending delivery" })
    }
  }
  if (blocked.length === 0) return { ok: true, agents, statusMap }
  return {
    ok: false,
    kind: "not_idle",
    blocked,
    message: formatMissionAgentsIdleError(blocked),
  }
}

export async function assertAllMissionAgentsIdle(input: {
  registry: RegistryStore
  client: PluginInput["client"]
  directory: string
  plugin: PluginInput
  missionId: string
  scopes: RegistryScope[]
}) {
  const result = await checkMissionAgentsIdle(input)
  if (result.ok) return result
  throw new Error(result.message)
}

/** Poll until inner/retro agents are idle — covers the post-delivery session busy race. */
export async function waitForAllMissionAgentsIdle(input: {
  registry: RegistryStore
  client: PluginInput["client"]
  directory: string
  plugin: PluginInput
  missionId: string
  scopes: RegistryScope[]
  timeoutMs?: number
  pollIntervalMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? defaultIdleWaitTimeoutMs()
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_RETRO_IDLE_POLL_MS
  const startedAt = Date.now()
  let lastNotIdle: Extract<MissionAgentsIdleCheck, { ok: false; kind: "not_idle" }> | undefined

  while (Date.now() - startedAt < timeoutMs) {
    const result = await checkMissionAgentsIdle(input)
    if (result.ok) {
      const waited_ms = Date.now() - startedAt
      return { ...result, waited_ms }
    }
    if (result.kind === "not_idle") {
      lastNotIdle = result
      const remaining = timeoutMs - (Date.now() - startedAt)
      if (remaining <= 0) break
      await Bun.sleep(Math.min(pollIntervalMs, remaining))
      continue
    }
    throw new Error(result.message)
  }

  throw new Error(lastNotIdle?.message ?? "Timed out waiting for mission agents to become idle")
}

/** When missions.yaml is retro and Lead calls mission_complete(done), both retro rollup tracks must finish. */
export function assertRetroReadyForComplete(registry: RegistryStore, missionId: string) {
  const readiness = registry.retroCompleteReadiness(missionId)
  if (readiness.ready) return readiness
  throw new Error(
    `Mission ${missionId} retro rollup incomplete; wait for architect/curator summary registration before mission_complete(done): ${readiness.pending.join(", ")}`,
  )
}

export async function abortMissionSessions(plugin: PluginInput, sessionIds: string[]) {
  const unique = [...new Set(sessionIds)]
  if (unique.length === 0) return []
  if (!(await opencodeHttpReady(plugin))) {
    return unique.map((sessionId) => ({
      session_id: sessionId,
      aborted: false as const,
      error: "OpenCode HTTP unavailable",
    }))
  }
  return Promise.all(
    unique.map(async (sessionId) => {
      try {
        await abortSessionHttp(plugin, sessionId)
        return { session_id: sessionId, aborted: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { session_id: sessionId, aborted: false as const, error: message }
      }
    }),
  )
}

export async function deleteMissionSessions(
  plugin: PluginInput,
  sessionIds: string[],
  client: GatehouseClient = plugin.client as GatehouseClient,
) {
  const unique = [...new Set(sessionIds)]
  if (unique.length === 0) return []
  if (shouldRetainInnerSessions()) {
    return unique.map((sessionId) => ({ session_id: sessionId, deleted: false as const, retained: true as const }))
  }
  return Promise.all(
    unique.map(async (sessionId) => {
      try {
        await deleteSession(client, plugin.directory, sessionId, plugin)
        return { session_id: sessionId, deleted: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { session_id: sessionId, deleted: false as const, error: message }
      }
    }),
  )
}

export async function archiveMissionManifest(projectDirectory: string, manifest: TreeManifest) {
  if (manifest.status === "archived") return manifest
  const archived: TreeManifest = {
    ...manifest,
    status: "archived",
    archived_at: new Date().toISOString(),
  }
  await writeManifest(projectDirectory, archived)
  const index = await readTreesIndex(projectDirectory)
  const entry = index.trees.find((item) => item.mission_id === manifest.mission_id)
  if (entry) {
    await upsertTreesIndex(projectDirectory, { ...entry, status: "archived" })
  }
  return archived
}

export function missionEndedOuterMessage(
  missionId: string,
  status: MissionTerminalStatus,
  projectDirectory: string,
  input?: { retroSkipped?: boolean },
) {
  const names = readAgentNamesSync(projectDirectory)
  const locale = readLocaleSync(projectDirectory)
  const statusLabel = gatehouseMessage(
    status === "cancelled" ? "mission.status.cancelled" : "mission.status.ended",
    locale,
  )
  const messageKey = input?.retroSkipped ? "mission.ended.no_retro" : "mission.ended"
  return renderGatehouseTemplate(
    gatehouseMessage(messageKey, locale, {
      mission_id: missionId,
      status_label: statusLabel,
      status,
      lead_name: names.lead,
    }),
    names,
  )
}

export async function notifyMissionEndedToOuter(
  registry: RegistryStore,
  input: {
    missionId: string
    status: MissionTerminalStatus
    projectDirectory: string
    retroSkipped?: boolean
  },
) {
  const content = missionEndedOuterMessage(input.missionId, input.status, input.projectDirectory, {
    retroSkipped: input.retroSkipped,
  })
  const profiles = ["architect", "curator"] as const
  const deliveries: Array<{ profile: string; delivery: string; error?: string }> = []
  for (const profile of profiles) {
    const recipient = registry.byProfile(profile, "outer")
    if (!recipient) {
      deliveries.push({ profile, delivery: "skipped", error: "not registered" })
      continue
    }
    const result = await registry.deliverSystemMessage(recipient, content, recipient.profile)
    deliveries.push({
      profile,
      delivery: result.status,
      ...(result.error && { error: result.error }),
    })
  }
  await registry.flushPendingDeliveries()
  return deliveries
}

export async function finalizeMissionComplete(input: {
  projectDirectory: string
  missionId: string
  status: MissionTerminalStatus
  registry: RegistryStore
}) {
  const manifest = await readManifest(input.projectDirectory, input.missionId)
  const retro = await readRetroManifest(input.projectDirectory, input.missionId)

  const doc = await readMissionsDocument(input.projectDirectory)
  const mission = requireMission(doc, input.missionId)
  if (mission.status === input.status) {
    if (input.status === "done" || input.status === "cancelled") {
      input.registry.syncMissionRegistryStatus(input.missionId, input.status, mission.completed_at)
    }
    return { mission, manifest, retro, status_unchanged: true as const }
  }
  mission.status = input.status
  if (input.status === "done" && !mission.completed_at) mission.completed_at = new Date().toISOString()
  await writeMissionsDocument(input.projectDirectory, doc)
  input.registry.syncMissionRegistryStatus(
    input.missionId,
    input.status,
    input.status === "done" ? mission.completed_at : undefined,
  )
  deactivateInnerAgentsForMissions(input.projectDirectory, [input.missionId])
  deactivateRetroAgentsForMissions(input.projectDirectory, [input.missionId])
  deactivateExtractAgentsForMissions(input.projectDirectory, [input.missionId])
  deactivateVerifyAgentsForMissions(input.projectDirectory, [input.missionId])
  if (manifest) await archiveMissionManifest(input.projectDirectory, manifest)
  return { mission, manifest, retro, status_unchanged: false as const }
}
