import path from "node:path"
import { agentName, readAgentNamesSync } from "../names.ts"
import { parseMissionsFile, type MissionEntry } from "../missions/parse.ts"
import {
  extractSessionTitle,
  leadDir,
  nodeContextDir,
  phaseContextDir,
  portalNodeDisplayName,
  retroSessionTitle,
  verifySessionTitle,
} from "../paths.ts"
import { addTokens, aggregateAssistantMessages, emptyTokens, type TokenBreakdown } from "../metrics/aggregate.ts"
import { collectManifestSessionIds } from "../missions/lifecycle.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { sessionDurationMs } from "../session/client.ts"
import {
  readExtractManifest,
  readManifest,
  readRetroManifest,
  readTreesIndex,
  readVerifyManifest,
} from "../tree/store.ts"
import type { ExtractManifest, RetroManifest, TreeManifest, VerifyManifest } from "../tree/types.ts"
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

export function usageFromSessionMessages(
  messages: unknown,
  detail?: Record<string, unknown>,
): SessionUsage {
  if (!Array.isArray(messages)) {
    return usageFromSessionDetail(undefined)
  }
  const agg = aggregateAssistantMessages(
    messages.filter(isRecord).map((row) => ({
      info: isRecord(row.info) ? row.info : row,
    })),
  )
  return {
    tokens: { ...agg.tokens },
    cost: agg.cost,
    duration_ms: sessionDurationMs(detail) ?? 0,
  }
}

export function usageFromSessionDetail(detail: Record<string, unknown> | undefined): SessionUsage {
  if (!detail) {
    return { tokens: emptyTokens(), cost: 0, duration_ms: 0 }
  }
  return usageFromMetricsRecord({
    cost: detail.cost,
    tokens: detail.tokens,
    duration_ms: sessionDurationMs(detail) ?? 0,
  })
}

export function usageFromNodeMetrics(raw: unknown): SessionUsage | undefined {
  if (!isRecord(raw)) return undefined
  const usage = usageFromMetricsRecord({
    cost: raw.cost,
    tokens: raw.tokens,
    duration_ms: raw.duration_ms,
  })
  if (usage.cost === 0 && usage.tokens.total === 0 && usage.duration_ms === 0) return undefined
  return usage
}

function usageFromMetricsRecord(input: {
  cost: unknown
  tokens: unknown
  duration_ms: unknown
}): SessionUsage {
  const rawTokens = isRecord(input.tokens) ? input.tokens : undefined
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
    cost: typeof input.cost === "number" ? input.cost : 0,
    duration_ms: typeof input.duration_ms === "number" ? input.duration_ms : 0,
  }
}

function sessionUsageTokensMissing(usage: SessionUsage | undefined) {
  if (!usage) return true
  return usage.cost === 0 && usage.tokens.total === 0
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

function pushRole(
  roles: TeamStatsRole[],
  totals: SessionUsage,
  sessionUsage: Map<string, SessionUsage>,
  input: { node_id: string; label: string; session_id: string },
) {
  const usage = sessionUsage.get(input.session_id) ?? usageFromSessionDetail(undefined)
  mergeUsage(totals, usage)
  roles.push({
    node_id: input.node_id,
    label: input.label,
    session_id: input.session_id,
    tokens: { ...usage.tokens },
    cost: usage.cost,
    duration_ms: usage.duration_ms,
  })
}

export function buildMissionStats(
  mission: MissionEntry,
  manifest: TreeManifest | undefined,
  sessionUsage: Map<string, SessionUsage>,
  retro?: RetroManifest,
  extract?: ExtractManifest,
  verify?: VerifyManifest,
) {
  const totals: SessionUsage = { tokens: emptyTokens(), cost: 0, duration_ms: 0 }
  const roles: TeamStatsRole[] = []

  if (manifest) {
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      pushRole(roles, totals, sessionUsage, {
        node_id: nodeId,
        label: roleLabel(manifest, nodeId),
        session_id: node.session_id,
      })
    }
  }

  if (retro) {
    pushRole(roles, totals, sessionUsage, {
      node_id: "retro:analyst",
      label: retroSessionTitle(mission.id),
      session_id: retro.retro_session_id,
    })
  }

  if (extract) {
    for (const [nodeId, node] of Object.entries(extract.nodes)) {
      pushRole(roles, totals, sessionUsage, {
        node_id: `extract:${nodeId}`,
        label: extractSessionTitle(mission.id, nodeId),
        session_id: node.extract_session_id,
      })
    }
  }

  if (verify) {
    for (const [nodeId, node] of Object.entries(verify.nodes)) {
      pushRole(roles, totals, sessionUsage, {
        node_id: `verify:${nodeId}`,
        label: verifySessionTitle(mission.id, nodeId),
        session_id: node.verify_session_id,
      })
    }
  }

  roles.sort((a, b) => a.label.localeCompare(b.label))

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

async function fetchSessionMessagesHttp(opencodeUrl: string, projectDirectory: string, sessionId: string) {
  const url = new URL(`/session/${encodeURIComponent(sessionId)}/message`, opencodeUrl)
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
  if (isRecord(body) && Array.isArray(body.data)) return body.data
  if (Array.isArray(body)) return body
  return undefined
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
      let sessionUsageEntry = usageFromSessionDetail(detail)
      if (sessionUsageTokensMissing(sessionUsageEntry)) {
        const messages = await fetchSessionMessagesHttp(opencodeUrl, projectDirectory, current)
        sessionUsageEntry = usageFromSessionMessages(messages, detail)
      }
      usage.set(current, sessionUsageEntry)
    }
  })
  await Promise.all(workers)
  return usage
}

async function readLocalMetricsFile(metricsPath: string) {
  const file = Bun.file(metricsPath)
  if (!(await file.exists())) return undefined
  try {
    return usageFromNodeMetrics(JSON.parse(await file.text()))
  } catch {
    return undefined
  }
}

async function readLocalNodeMetricsUsage(projectDirectory: string, missionId: string, nodeId: string) {
  const metricsPath = path.join(nodeContextDir(projectDirectory, missionId, nodeId), "metrics.json")
  return readLocalMetricsFile(metricsPath)
}

async function readLocalPhaseMetricsUsage(
  projectDirectory: string,
  missionId: string,
  phase: "retro" | "extract" | "verify",
  nodeId: string,
) {
  const metricsPath = path.join(phaseContextDir(projectDirectory, missionId, phase, nodeId), "metrics.json")
  return readLocalMetricsFile(metricsPath)
}

async function enrichSessionUsageFromLocalContext(
  projectDirectory: string,
  manifests: Map<string, TreeManifest>,
  sessionUsage: Map<string, SessionUsage>,
  retroManifests: Map<string, RetroManifest>,
  extractManifests: Map<string, ExtractManifest>,
  verifyManifests: Map<string, VerifyManifest>,
) {
  for (const [missionId, manifest] of manifests) {
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      if (!sessionUsageTokensMissing(sessionUsage.get(node.session_id))) continue
      const local = await readLocalNodeMetricsUsage(projectDirectory, missionId, nodeId)
      if (local) sessionUsage.set(node.session_id, local)
    }
  }
  for (const [missionId, retro] of retroManifests) {
    if (!sessionUsageTokensMissing(sessionUsage.get(retro.retro_session_id))) continue
    const local = await readLocalPhaseMetricsUsage(projectDirectory, missionId, "retro", "retro-analyst")
    if (local) sessionUsage.set(retro.retro_session_id, local)
  }
  for (const [missionId, extract] of extractManifests) {
    for (const [nodeId, node] of Object.entries(extract.nodes)) {
      if (!sessionUsageTokensMissing(sessionUsage.get(node.extract_session_id))) continue
      const local = await readLocalPhaseMetricsUsage(projectDirectory, missionId, "extract", nodeId)
      if (local) sessionUsage.set(node.extract_session_id, local)
    }
  }
  for (const [missionId, verify] of verifyManifests) {
    for (const [nodeId, node] of Object.entries(verify.nodes)) {
      if (!sessionUsageTokensMissing(sessionUsage.get(node.verify_session_id))) continue
      const local = await readLocalPhaseMetricsUsage(projectDirectory, missionId, "verify", nodeId)
      if (local) sessionUsage.set(node.verify_session_id, local)
    }
  }
}

async function readMissions(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) return parseMissionsFile("schema_version: 1\nmissions: []\n").missions
  return parseMissionsFile(await file.text()).missions
}

function teamStatsCacheKey(projectDirectory: string, opencodeUrl?: string) {
  return `${projectDirectory}\0${opencodeUrl ?? ""}`
}

function collectMissionSessionIds(
  manifest: TreeManifest | undefined,
  retro?: RetroManifest,
  extract?: ExtractManifest,
  verify?: VerifyManifest,
) {
  if (manifest) return collectManifestSessionIds(manifest, retro, extract, verify)
  const ids = new Set<string>()
  if (retro) {
    ids.add(retro.retro_session_id)
  }
  if (extract) {
    for (const node of Object.values(extract.nodes)) ids.add(node.extract_session_id)
  }
  if (verify) {
    for (const node of Object.values(verify.nodes)) ids.add(node.verify_session_id)
  }
  return [...ids]
}

async function loadMissionManifests(projectDirectory: string, missionIds: Set<string>) {
  const manifests = new Map<string, TreeManifest>()
  const retroManifests = new Map<string, RetroManifest>()
  const extractManifests = new Map<string, ExtractManifest>()
  const verifyManifests = new Map<string, VerifyManifest>()

  for (const missionId of missionIds) {
    const manifest = await readManifest(projectDirectory, missionId)
    if (manifest) manifests.set(missionId, manifest)
    const retro = await readRetroManifest(projectDirectory, missionId)
    if (retro) retroManifests.set(missionId, retro)
    const extract = await readExtractManifest(projectDirectory, missionId)
    if (extract) extractManifests.set(missionId, extract)
    const verify = await readVerifyManifest(projectDirectory, missionId)
    if (verify) verifyManifests.set(missionId, verify)
  }

  return { manifests, retroManifests, extractManifests, verifyManifests }
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

  const { manifests, retroManifests, extractManifests, verifyManifests } = await loadMissionManifests(
    projectDirectory,
    missionIds,
  )

  const sessionIds = new Set<string>()
  for (const missionId of missionIds) {
    for (const sessionId of collectMissionSessionIds(
      manifests.get(missionId),
      retroManifests.get(missionId),
      extractManifests.get(missionId),
      verifyManifests.get(missionId),
    )) {
      sessionIds.add(sessionId)
    }
  }
  for (const agent of registry.agents) {
    if (agent.scope === "outer" && agent.status === "active") sessionIds.add(agent.sessionId)
  }

  const baseUrl = opencodeUrl ?? process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
  const reachable = await opencodeReachable(baseUrl)
  const sessionUsage = await loadSessionUsageMap(baseUrl, projectDirectory, [...sessionIds], reachable)
  await enrichSessionUsageFromLocalContext(
    projectDirectory,
    manifests,
    sessionUsage,
    retroManifests,
    extractManifests,
    verifyManifests,
  )

  const snapshot: TeamStatsSnapshot = {
    project_directory: projectDirectory,
    updated_at: new Date().toISOString(),
    opencode_reachable: reachable,
    outer: buildOuterOverview(registry.agents, agentNames, sessionUsage),
    missions: [...missions]
      .sort((a, b) => missionSortTime(b) - missionSortTime(a))
      .map((mission) =>
        buildMissionStats(
          mission,
          manifests.get(mission.id),
          sessionUsage,
          retroManifests.get(mission.id),
          extractManifests.get(mission.id),
          verifyManifests.get(mission.id),
        ),
      ),
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
