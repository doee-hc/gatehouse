import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { readMissionsDocument, writeMissionsDocument } from "./store.ts"
import type { MissionsDocument } from "./parse.ts"
import { readManifest, readRetroManifest, readTreesIndex, upsertTreesIndex, writeManifest } from "../tree/store.ts"
import type { RetroManifest, TreeManifest } from "../tree/types.ts"
import { getRegistryStore } from "../registry/context.ts"
import type { RegistryStore } from "../registry/store.ts"
import { LEAD_OPENCODE, type RegistryScope } from "../registry/types.ts"
import {
  deactivateInnerAgentsForMissions,
  deactivateRetroAgentsForMissions,
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

export function collectManifestSessionIds(manifest: TreeManifest, retro?: RetroManifest) {
  const ids = new Set<string>()
  for (const node of Object.values(manifest.nodes)) ids.add(node.session_id)
  if (retro) {
    for (const node of Object.values(retro.nodes)) {
      ids.add(node.exec_session_id)
      ids.add(node.retro_session_id)
    }
  }
  return [...ids]
}

function agentsForIdleCheck(registry: RegistryStore, missionId: string, scopes: RegistryScope[]) {
  return scopes.flatMap((scope) => registry.list({ scope, missionId }))
}

export async function assertAllMissionAgentsIdle(input: {
  registry: RegistryStore
  client: PluginInput["client"]
  directory: string
  plugin: PluginInput
  missionId: string
  scopes: RegistryScope[]
}) {
  const agents = agentsForIdleCheck(input.registry, input.missionId, input.scopes)
  if (agents.length === 0) {
    throw new Error(`No registry agents for mission ${input.missionId} (scopes: ${input.scopes.join(", ")})`)
  }
  const statusMap = await sessionStatusById(input.client, input.directory, input.plugin)
  if (!statusMap) {
    throw new Error("Session status unavailable; cannot verify mission agents are idle")
  }
  const blocked: Array<{ agentId: string; sessionId: string; reason: string }> = []
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
  if (blocked.length === 0) return { agents, statusMap }
  throw new Error(
    `All mission agents must be idle before proceeding: ${blocked.map((item) => `${item.agentId} (${item.reason})`).join("; ")}`,
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
) {
  const names = readAgentNamesSync(projectDirectory)
  const locale = readLocaleSync(projectDirectory)
  const statusLabel = gatehouseMessage(
    status === "cancelled" ? "mission.status.cancelled" : "mission.status.ended",
    locale,
  )
  return renderGatehouseTemplate(
    gatehouseMessage("mission.ended", locale, {
      mission_id: missionId,
      status_label: statusLabel,
      status,
    }),
    names,
  )
}

export async function notifyMissionEndedToOuter(
  registry: RegistryStore,
  input: { missionId: string; status: MissionTerminalStatus; projectDirectory: string },
) {
  const content = missionEndedOuterMessage(input.missionId, input.status, input.projectDirectory)
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
  if (manifest) await archiveMissionManifest(input.projectDirectory, manifest)
  return { mission, manifest, retro, status_unchanged: false as const }
}
