import path from "node:path"
import { agentName, readAgentNamesSync } from "../names.ts"
import { parseMissionsFile, type MissionEntry } from "../missions/parse.ts"
import { leadDir, portalNodeDisplayName } from "../paths.ts"
import { addTokens, emptyTokens, type TokenBreakdown } from "../metrics/aggregate.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { sessionDurationMs } from "../session/client.ts"
import { readManifest, readTreesIndex } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { createPortalDataCache } from "./portal-cache.ts"
import { getPortalDisplaySettings } from "./portal-display-settings.ts"

export type TeamStatsRole = {
  node_id: string
  label: string
  session_id: string
  tokens: TokenBreakdown
  cost: number
  duration_ms: number
}

export type TeamStatsMission = {
  id: string
  status: string
  objective?: string
  started_at?: string
  completed_at?: string
  tokens: TokenBreakdown
  cost: number
  duration_ms: number
  wall_clock_ms?: number
  roles: TeamStatsRole[]
}

export type TeamStatsOuterRole = {
  profile: string
  label: string
  session_id: string
  tokens: TokenBreakdown
  cost: number
  duration_ms: number
}

export type TeamStatsSnapshot = {
  project_directory: string
  updated_at: string
  opencode_reachable: boolean
  outer: TeamStatsOuterRole[]
  missions: TeamStatsMission[]
}

export type SessionUsage = {
  tokens: TokenBreakdown
  cost: number
  duration_ms: number
}

const FETCH_CONCURRENCY = 12

const teamStatsCache = createPortalDataCache<TeamStatsSnapshot>({
  ttlMs: () => getPortalDisplaySettings().teamStatsTtlMs,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function usageFromSessionDetail(detail: Record<string, unknown> | undefined): SessionUsage {
  if (!detail) {
    return { tokens: emptyTokens(), cost: 0, duration_ms: 0 }
  }
  const rawTokens = isRecord(detail.tokens) ? detail.tokens : undefined
  const cache = isRecord(rawTokens?.cache) ? rawTokens.cache : undefined
  const tokens = emptyTokens()
  addTokens(tokens, {
    input: typeof rawTokens?.input === "number" ? rawTokens.input : 0,
    output: typeof rawTokens?.output === "number" ? rawTokens.output : 0,
    reasoning: typeof rawTokens?.reasoning === "number" ? rawTokens.reasoning : 0,
    cache: {
      read: typeof cache?.read === "number" ? cache.read : 0,
      write: typeof cache?.write === "number" ? cache.write : 0,
    },
  })
  return {
    tokens,
    cost: typeof detail.cost === "number" ? detail.cost : 0,
    duration_ms: sessionDurationMs(detail) ?? 0,
  }
}

function mergeUsage(target: SessionUsage, source: SessionUsage) {
  addTokens(target.tokens, source.tokens)
  target.cost += source.cost
  target.duration_ms += source.duration_ms
}

function wallClockMs(mission: MissionEntry) {
  if (!mission.started_at) return undefined
  const start = new Date(mission.started_at).getTime()
  if (Number.isNaN(start)) return undefined
  const endValue = mission.completed_at ?? new Date().toISOString()
  const end = new Date(endValue).getTime()
  if (Number.isNaN(end)) return undefined
  return Math.max(0, end - start)
}

function missionSortTime(mission: MissionEntry) {
  const value = mission.completed_at ?? mission.started_at
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function roleLabel(manifest: TreeManifest, nodeId: string) {
  const node = manifest.nodes[nodeId]
  if (!node) return nodeId
  return portalNodeDisplayName(nodeId, node.display_name)
}

export function buildMissionStats(
  mission: MissionEntry,
  manifest: TreeManifest | undefined,
  sessionUsage: Map<string, SessionUsage>,
) {
  const totals: SessionUsage = { tokens: emptyTokens(), cost: 0, duration_ms: 0 }
  const roles: TeamStatsRole[] = []

  if (manifest) {
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      const usage = sessionUsage.get(node.session_id) ?? usageFromSessionDetail(undefined)
      mergeUsage(totals, usage)
      roles.push({
        node_id: nodeId,
        label: roleLabel(manifest, nodeId),
        session_id: node.session_id,
        tokens: { ...usage.tokens },
        cost: usage.cost,
        duration_ms: usage.duration_ms,
      })
    }
    roles.sort((a, b) => a.label.localeCompare(b.label))
  }

  return {
    id: mission.id,
    status: mission.status,
    ...(mission.objective && { objective: mission.objective }),
    ...(mission.started_at && { started_at: mission.started_at }),
    ...(mission.completed_at && { completed_at: mission.completed_at }),
    tokens: totals.tokens,
    cost: totals.cost,
    duration_ms: totals.duration_ms,
    ...(wallClockMs(mission) !== undefined && { wall_clock_ms: wallClockMs(mission) }),
    roles,
  } satisfies TeamStatsMission
}

export function buildOuterOverview(
  agents: RegistryAgent[],
  agentNames: ReturnType<typeof readAgentNamesSync>,
  sessionUsage: Map<string, SessionUsage>,
) {
  return agents
    .filter((agent) => agent.scope === "outer" && agent.status === "active")
    .map((agent) => {
      const usage = sessionUsage.get(agent.sessionId) ?? usageFromSessionDetail(undefined)
      return {
        profile: agent.profile,
        label: agentName(agentNames, agent.profile) || agent.displayName,
        session_id: agent.sessionId,
        tokens: { ...usage.tokens },
        cost: usage.cost,
        duration_ms: usage.duration_ms,
      }
    })
    .sort((a, b) => a.profile.localeCompare(b.profile))
}

async function opencodeReachable(opencodeUrl: string) {
  const response = await fetch(new URL("/global/health", opencodeUrl), {
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined)
  if (!response?.ok) return false
  const body = (await response.json()) as unknown
  return isRecord(body) && body.healthy === true
}

async function fetchSessionDetailHttp(opencodeUrl: string, projectDirectory: string, sessionId: string) {
  const url = new URL(`/session/${encodeURIComponent(sessionId)}`, opencodeUrl)
  url.searchParams.set("directory", projectDirectory)
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-opencode-directory": projectDirectory,
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined)
  if (!response?.ok) return undefined
  const body = (await response.json()) as unknown
  if (isRecord(body) && isRecord(body.data)) return body.data
  if (isRecord(body)) return body
  return undefined
}

async function loadSessionUsageMap(
  opencodeUrl: string,
  projectDirectory: string,
  sessionIds: string[],
  reachable: boolean,
) {
  const usage = new Map<string, SessionUsage>()
  if (!reachable || sessionIds.length === 0) return usage

  let index = 0
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, sessionIds.length) }, async () => {
    while (index < sessionIds.length) {
      const current = sessionIds[index]
      index += 1
      if (!current) continue
      const detail = await fetchSessionDetailHttp(opencodeUrl, projectDirectory, current)
      usage.set(current, usageFromSessionDetail(detail))
    }
  })
  await Promise.all(workers)
  return usage
}

async function readMissions(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) return parseMissionsFile("schema_version: 1\nmissions: []\n").missions
  return parseMissionsFile(await file.text()).missions
}

function teamStatsCacheKey(projectDirectory: string, opencodeUrl?: string) {
  return `${projectDirectory}\0${opencodeUrl ?? ""}`
}

async function loadTeamStatsSnapshot(projectDirectory: string, opencodeUrl?: string) {
  const missions = await readMissions(projectDirectory)
  const treesIndex = await readTreesIndex(projectDirectory)
  const registry = new RegistryDatabase(projectDirectory, { readonly: true }).load()
  const agentNames = readAgentNamesSync(projectDirectory)

  const missionIds = new Set([
    ...missions.map((mission) => mission.id),
    ...treesIndex.trees.map((entry) => entry.mission_id),
  ])

  const manifests = new Map<string, TreeManifest>()
  for (const missionId of missionIds) {
    const manifest = await readManifest(projectDirectory, missionId)
    if (manifest) manifests.set(missionId, manifest)
  }

  const sessionIds = new Set<string>()
  for (const manifest of manifests.values()) {
    for (const node of Object.values(manifest.nodes)) sessionIds.add(node.session_id)
  }
  for (const agent of registry.agents) {
    if (agent.scope === "outer" && agent.status === "active") sessionIds.add(agent.sessionId)
  }

  const baseUrl = opencodeUrl ?? process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
  const reachable = await opencodeReachable(baseUrl)
  const sessionUsage = await loadSessionUsageMap(baseUrl, projectDirectory, [...sessionIds], reachable)

  const snapshot: TeamStatsSnapshot = {
    project_directory: projectDirectory,
    updated_at: new Date().toISOString(),
    opencode_reachable: reachable,
    outer: buildOuterOverview(registry.agents, agentNames, sessionUsage),
    missions: [...missions]
      .sort((a, b) => missionSortTime(b) - missionSortTime(a))
      .map((mission) => buildMissionStats(mission, manifests.get(mission.id), sessionUsage)),
  }

  return snapshot
}

export async function buildTeamStatsSnapshot(projectDirectory: string, opencodeUrl?: string) {
  const key = teamStatsCacheKey(projectDirectory, opencodeUrl)
  return teamStatsCache.get(key, () => loadTeamStatsSnapshot(projectDirectory, opencodeUrl))
}

export function clearTeamStatsCacheForTests() {
  teamStatsCache.clear()
}
