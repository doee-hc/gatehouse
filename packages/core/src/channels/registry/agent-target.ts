import { existsSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import type { ChannelBridgeConfig } from "../types.ts"
import type { OpencodeClient } from "../opencode/client.ts"
import { DEFAULT_AGENT_ID } from "../constants.ts"
import { ensureLeadAgentTarget } from "./lead-session.ts"
import { loadAgentDescriptions } from "./agent-descriptions.ts"
import { readCurrentMissionId } from "../missions.ts"

export { DEFAULT_AGENT_ID }

export type RegistryAgentTarget = {
  agentId: string
  scope: string
  sessionId: string
  displayName: string
  opencodeAgent: string
  missionId?: string
  nodeId?: string
}

function registryDbPath(projectDir: string) {
  return path.join(projectDir, ".gatehouse", "registry.db")
}

function withRegistryDb<T>(projectDir: string, run: (db: Database) => T) {
  const dbPath = registryDbPath(projectDir)
  if (!existsSync(dbPath)) return undefined
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout = 5000;")
    return run(db)
  } finally {
    db.close()
  }
}

function rowToTarget(row: {
  agent_id: string
  scope: string
  session_id: string
  display_name: string
  profile: string
  mission_id: string | null
  node_id: string | null
}): RegistryAgentTarget | undefined {
  const sessionId = row.session_id?.trim()
  if (!sessionId) return undefined
  return {
    agentId: row.agent_id,
    scope: row.scope,
    sessionId,
    displayName: row.display_name,
    opencodeAgent: row.profile,
    ...(row.mission_id && { missionId: row.mission_id }),
    ...(row.node_id && { nodeId: row.node_id }),
  }
}

export function isAgentSwitchable(agent: RegistryAgentTarget, currentMissionId: string | undefined) {
  if (agent.scope === "outer") return true
  if (agent.scope === "inner" || agent.scope === "retro") {
    return currentMissionId !== undefined && agent.missionId === currentMissionId
  }
  return false
}

export function readRegistryAgentById(projectDir: string, agentId: string) {
  const trimmed = agentId.trim()
  if (!trimmed) return undefined
  return withRegistryDb(projectDir, (db) => {
    const row = db
      .query(
        `SELECT agent_id, scope, session_id, display_name, profile, mission_id, node_id
         FROM registry_agent
         WHERE agent_id = ? AND status = 'active'
         LIMIT 1`,
      )
      .get(trimmed) as
      | {
          agent_id: string
          scope: string
          session_id: string
          display_name: string
          profile: string
          mission_id: string | null
          node_id: string | null
        }
      | null
    if (!row) return undefined
    return rowToTarget(row)
  })
}

export function listActiveRegistryAgents(projectDir: string) {
  return (
    withRegistryDb(projectDir, (db) => {
      const rows = db
        .query(
          `SELECT agent_id, scope, session_id, display_name, profile, mission_id, node_id
           FROM registry_agent
           WHERE status = 'active'
           ORDER BY scope, agent_id`,
        )
        .all() as Array<{
        agent_id: string
        scope: string
        session_id: string
        display_name: string
        profile: string
        mission_id: string | null
        node_id: string | null
      }>
      return rows
        .map((row) => rowToTarget(row))
        .filter((agent): agent is RegistryAgentTarget => agent !== undefined)
    }) ?? []
  )
}

export async function listSwitchableAgents(projectDir: string) {
  const currentMissionId = await readCurrentMissionId(projectDir)
  return listActiveRegistryAgents(projectDir).filter((agent) => isAgentSwitchable(agent, currentMissionId))
}

function formatAgentEntry(agent: RegistryAgentTarget, description: string) {
  return `/agent ${agent.agentId}\n${description}`
}

export function formatAgentDirectory(
  agents: RegistryAgentTarget[],
  options?: {
    currentAgentId?: string
    currentMissionId?: string
    descriptions?: Map<string, string>
  },
) {
  const describe = (agent: RegistryAgentTarget) =>
    options?.descriptions?.get(agent.agentId) ?? agent.displayName

  const lines: string[] = []
  if (options?.currentAgentId) {
    const current = agents.find((agent) => agent.agentId === options.currentAgentId)
    if (current) {
      lines.push("Current conversation:")
      lines.push(formatAgentEntry(current, describe(current)))
    } else {
      lines.push(`Current binding: ${options.currentAgentId} (no longer in list — run /agent again)`)
    }
    lines.push("")
  }
  if (options?.currentMissionId) {
    lines.push(`Current mission: ${options.currentMissionId}`)
    lines.push("")
  }
  if (agents.length === 0) {
    lines.push("No agents available. Complete Gatehouse registration in OpenCode first.")
    return lines.join("\n")
  }
  lines.push("Available agents:")
  for (let i = 0; i < agents.length; i++) {
    if (i > 0) lines.push("")
    const agent = agents[i]!
    lines.push(formatAgentEntry(agent, describe(agent)))
  }
  return lines.join("\n")
}

export function formatAgentDirectoryForProject(
  projectDir: string,
  agents: RegistryAgentTarget[],
  options?: { currentAgentId?: string; currentMissionId?: string },
) {
  const descriptions = loadAgentDescriptions(projectDir, agents)
  return formatAgentDirectory(agents, { ...options, descriptions })
}

export function readRegistryLeadSessionId(projectDir: string) {
  return readRegistryAgentById(projectDir, DEFAULT_AGENT_ID)?.sessionId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function opencodeSessionExists(client: OpencodeClient, config: ChannelBridgeConfig, sessionId: string) {
  const detail = await client.session
    .get({
      query: { directory: config.projectDir },
      path: { id: sessionId },
    })
    .catch(() => undefined)
  return isRecord(detail) && isRecord(detail.data)
}

export async function resolveProjectLeadSession(client: OpencodeClient, config: ChannelBridgeConfig) {
  const target = await ensureLeadAgentTarget(client, config)
  return target.sessionId
}

export async function resolveAgentTarget(client: OpencodeClient, config: ChannelBridgeConfig, agentId: string) {
  const trimmed = agentId.trim()
  if (trimmed === DEFAULT_AGENT_ID) {
    return ensureLeadAgentTarget(client, config)
  }
  const currentMissionId = await readCurrentMissionId(config.projectDir)
  const agent = readRegistryAgentById(config.projectDir, trimmed)
  if (!agent) {
    const switchable = await listSwitchableAgents(config.projectDir)
    const directory = formatAgentDirectoryForProject(config.projectDir, switchable, {
      currentMissionId: currentMissionId,
    })
    throw new Error(`Agent not found: "${trimmed}".\n\n${directory}`)
  }
  if (!isAgentSwitchable(agent, currentMissionId)) {
    const switchable = await listSwitchableAgents(config.projectDir)
    const reason =
      agent.scope === "inner" || agent.scope === "retro"
        ? `Agent "${trimmed}" belongs to another or ended mission — only inner/retro agents from the current mission can be switched.`
        : `Agent "${trimmed}" cannot be switched via this channel.`
    const missionHint = currentMissionId ? `Current mission: ${currentMissionId}.` : "No running/retro mission — inner agents unavailable."
    const directory = formatAgentDirectoryForProject(config.projectDir, switchable, {
      currentMissionId: currentMissionId,
    })
    throw new Error(`${reason}\n${missionHint}\n\n${directory}`)
  }
  if (!(await opencodeSessionExists(client, config, agent.sessionId))) {
    throw new Error(
      `Registry session (${agent.sessionId}) does not exist in OpenCode — reopen ${agent.agentId}.`,
    )
  }
  return agent
}
