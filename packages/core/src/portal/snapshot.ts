import path from "node:path"
import { agentName, normalizeOuterProfile, readAgentNamesSync } from "../names.ts"
import { globalOpencodeAgentDir } from "../setup/global-opencode.ts"
import { existsSync, statSync } from "node:fs"
import { RegistryDatabase } from "../registry/db.ts"
import {
  leadDir,
  gatehouseRoot,
  portalNodeDisplayName,
  skillDomainsRegistryPath,
  portalOfficeDir,
} from "../paths.ts"
import { readManifest, readTreesIndex } from "../tree/store.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"
import {
  parseMissionsFile,
  activePortalMissionIds,
  lingeringPortalMissionId,
  retroMissionIds,
  runningMissionIds,
} from "../missions/parse.ts"
import type { RegistryAgent } from "../registry/types.ts"
import type { TreeManifest } from "../tree/types.ts"
import { readActiveMission } from "./active-mission.ts"
import { agentSync } from "./agent-sync.ts"
import { createPortalDataCache } from "./portal-cache.ts"
import { portalCacheTtlMs } from "./portal-cache-ttl.ts"
import { spawnIdForAgent } from "./spawn-id.ts"
import { readOfficeLayoutManifest, readOfficeLayoutSpec, computeOfficeLayoutSpec } from "./office-layout.ts"
import { scheduleOfficeLayoutSync } from "./office-layout-schedule.ts"

export type PortalMission = {
  id: string
  status: string
  priority?: string
  objective?: string
  started_at?: string
  completed_at?: string
}

export type PortalSkill = {
  name: string
  domain: string
  path: string
}

export type PortalTreeNode = {
  node_id: string
  session_id: string
  parent: string | null
  skill_domain?: string
  display_name: string
  description?: string
}

export type PortalAgent = {
  agent_id: string
  scope: RegistryAgent["scope"]
  profile: string
  display_name: string
  session_id: string
  mission_id?: string
  node_id?: string
  status: "idle" | "busy" | "research"
  spawn_id: string
  description?: string
  skills?: string[]
  lingering?: boolean
}

export type PortalTree = {
  mission_id: string
  root_node: string
  status: string
  nodes: PortalTreeNode[]
}

export type PortalSnapshot = {
  project_directory: string
  updated_at: string
  active_mission_id?: string
  lingering_mission_id?: string
  running_mission_ids?: string[]
  retro_mission_ids?: string[]
  missions: PortalMission[]
  agents: PortalAgent[]
  tree?: PortalTree
  trees?: PortalTree[]
  skills: PortalSkill[]
  session_status: Record<string, string>
  opencode_reachable?: boolean
  office_layout?: {
    revision: string
    workstation_count: number
    ready: boolean
    bindings: { spawn_id: string; slot: number }[]
    warnings?: string[]
  }
  retro?: {
    mission_id: string
    active: boolean
    all_done: boolean
    pending_node_ids: string[]
    completed_node_ids: string[]
  }
}

async function readMissionsDocument(projectDirectory: string) {
  const file = Bun.file(path.join(leadDir(projectDirectory), "missions.yaml"))
  if (!(await file.exists())) {
    return parseMissionsFile("schema_version: 1\nmissions: []\n")
  }
  return parseMissionsFile(await file.text())
}

export async function warmPortalSessionIndex(projectDirectory: string, opencodeUrl?: string) {
  await agentSync(projectDirectory).refreshIndex(opencodeUrl)
}

async function readSkills(projectDirectory: string) {
  const skills: PortalSkill[] = []
  const domainsFile = Bun.file(skillDomainsRegistryPath(projectDirectory))
  const byDomainRoot = path.join(gatehouseRoot(projectDirectory), "skills", "by-domain")
  if (!existsSync(byDomainRoot)) return skills

  const domainIds = new Set<string>()
  if (await domainsFile.exists()) {
    const raw = parseYaml(await domainsFile.text())
    if (isRecord(raw) && Array.isArray(raw.domains)) {
      for (const entry of raw.domains) {
        if (!isRecord(entry)) continue
        const id = readString(entry.id)
        if (id) domainIds.add(id)
      }
    }
  }

  for await (const domainEntry of new Bun.Glob("*").scan({ cwd: byDomainRoot, onlyFiles: false })) {
    const domainPath = path.join(byDomainRoot, domainEntry)
    if (!statSync(domainPath, { throwIfNoEntry: false })?.isDirectory()) continue
    domainIds.add(domainEntry)
  }

  for (const domain of domainIds) {
    const domainPath = path.join(byDomainRoot, domain)
    if (!statSync(domainPath, { throwIfNoEntry: false })?.isDirectory()) continue
    for await (const skillDir of new Bun.Glob("*/SKILL.md").scan({ cwd: domainPath })) {
      const name = path.dirname(skillDir)
      skills.push({
        name,
        domain,
        path: path.join(".gatehouse", "skills", "by-domain", domain, name, "SKILL.md"),
      })
    }
  }

  return skills.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
}

function treeNodes(manifest: TreeManifest) {
  return Object.entries(manifest.nodes).map(([node_id, node]) => ({
    node_id,
    session_id: node.session_id,
    parent: node.parent,
    ...(node.skill_domain && { skill_domain: node.skill_domain }),
    display_name: portalNodeDisplayName(node_id, node.display_name),
    ...(node.description && { description: node.description }),
  }))
}

function manifestToPortalTree(manifest: TreeManifest): PortalTree {
  return {
    mission_id: manifest.mission_id,
    root_node: manifest.root_node,
    status: manifest.status,
    nodes: treeNodes(manifest),
  }
}

function resolveActiveMissionId(
  portalIds: string[],
  missions: PortalMission[],
  persistedId: string | undefined,
) {
  if (portalIds.length === 0) return undefined
  if (persistedId && portalIds.includes(persistedId)) return persistedId
  return portalIds[0]
}
async function fetchSessionStatus(projectDirectory: string, opencodeUrl: string) {
  const url = new URL("/session/status", opencodeUrl)
  url.searchParams.set("directory", projectDirectory)
  const response = await fetch(url, {
    headers: { "x-opencode-directory": projectDirectory },
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined)
  if (!response?.ok) return {} as Record<string, string>
  const body = (await response.json()) as unknown
  const data = isRecord(body) && isRecord(body.data) ? body.data : body
  if (!isRecord(data)) return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(data).flatMap(([sessionId, status]) => {
      if (!isRecord(status) || typeof status.type !== "string") return []
      return [[sessionId, status.type]]
    }),
  )
}

async function opencodeReachable(opencodeUrl: string) {
  const response = await fetch(new URL("/global/health", opencodeUrl), {
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined)
  if (!response?.ok) return false
  const body = (await response.json()) as unknown
  return isRecord(body) && body.healthy === true
}

export async function buildPortalSnapshot(projectDirectory: string, opencodeUrl?: string) {
  const missionsDoc = await readMissionsDocument(projectDirectory)
  const activeRecord = new RegistryDatabase(projectDirectory, { readonly: true }).getActiveMission()
  const missions: PortalMission[] = missionsDoc.missions.map((mission) => {
    if (!activeRecord || activeRecord.missionId !== mission.id) {
      return {
        id: mission.id,
        status: mission.status,
        ...(mission.priority && { priority: mission.priority }),
        ...(mission.objective && { objective: mission.objective }),
        ...(mission.started_at && { started_at: mission.started_at }),
        ...(mission.completed_at && { completed_at: mission.completed_at }),
      }
    }
    return {
      id: mission.id,
      status: mission.status,
      ...(activeRecord.priority && { priority: activeRecord.priority }),
      ...(activeRecord.objective && { objective: activeRecord.objective }),
      ...(activeRecord.startedAt && { started_at: activeRecord.startedAt }),
      ...(activeRecord.completedAt && { completed_at: activeRecord.completedAt }),
    }
  })
  const runningIds = runningMissionIds(missionsDoc)
  const retroIds = retroMissionIds(missionsDoc)
  const portalIds = activePortalMissionIds(missionsDoc)
  const portalSet = new Set(portalIds)
  const lingeringMissionId = lingeringPortalMissionId(missionsDoc)

  const persistedActive = await readActiveMission(projectDirectory)
  const activeMissionId = resolveActiveMissionId(portalIds, missions, persistedActive)

  let tree: PortalTree | undefined
  if (activeMissionId) {
    const manifest = await readManifest(projectDirectory, activeMissionId)
    if (manifest) tree = manifestToPortalTree(manifest)
  }
  if (!tree && lingeringMissionId) {
    const manifest = await readManifest(projectDirectory, lingeringMissionId)
    if (manifest) tree = manifestToPortalTree(manifest)
  }

  const registrySnapshot = new RegistryDatabase(projectDirectory, { readonly: true }).load()
  const reachable = opencodeUrl ? await opencodeReachable(opencodeUrl) : false
  const sessionStatus = reachable && opencodeUrl ? await fetchSessionStatus(projectDirectory, opencodeUrl) : {}

  const sync = agentSync(projectDirectory)
  const skills = await readSkills(projectDirectory)
  const agentDescriptions = await readOpencodeAgentDescriptions(projectDirectory)
  const agentNames = readAgentNamesSync(projectDirectory)
  const activeAgents = registrySnapshot.agents
    .filter((agent) => agent.status === "active")
    .filter((agent) => agent.scope === "outer" || (agent.missionId && portalSet.has(agent.missionId)))
    .map((agent) =>
      mapRegistryAgentToPortalAgent({
        agent,
        tree,
        skills,
        agentDescriptions,
        agentNames,
        sync,
        sessionStatus,
        reachable,
      }),
    )

  const lingeringAgents = lingeringMissionId
    ? registrySnapshot.agents
        .filter((agent) => agent.scope === "inner" && agent.missionId === lingeringMissionId)
        .map((agent) =>
          mapRegistryAgentToPortalAgent({
            agent,
            tree,
            skills,
            agentDescriptions,
            agentNames,
            sync,
            sessionStatus,
            reachable,
            lingering: true,
          }),
        )
    : []

  const agents = [...activeAgents, ...lingeringAgents]

  await sync.refreshIndex(opencodeUrl)

  const treesIndex = await readTreesIndex(projectDirectory)

  const layoutSpec =
    (await readOfficeLayoutSpec(projectDirectory)) ?? (await computeOfficeLayoutSpec(projectDirectory))
  const layoutManifest = await readOfficeLayoutManifest(projectDirectory)
  const officeLayoutReady =
    layoutManifest?.revision === layoutSpec.revision &&
    (await Bun.file(path.join(portalOfficeDir(projectDirectory), "scene-bg.png")).exists())

  if (layoutSpec && !officeLayoutReady) {
    scheduleOfficeLayoutSync(projectDirectory)
  }

  const retroMissionId = retroIds[0]
  const retro =
    retroMissionId &&
    (() => {
      const run = registrySnapshot.retroRuns.find((entry) => entry.missionId === retroMissionId)
      if (!run) return undefined
      const completed_node_ids = run.expectedNodeIds.filter((nodeId) =>
        registrySnapshot.retroCompletions.some(
          (item) => item.missionId === retroMissionId && item.nodeId === nodeId,
        ),
      )
      const pending_node_ids = run.expectedNodeIds.filter((nodeId) => !completed_node_ids.includes(nodeId))
      const all_done = pending_node_ids.length === 0 && run.expectedNodeIds.length > 0
      return {
        mission_id: retroMissionId,
        active: !all_done,
        all_done,
        pending_node_ids,
        completed_node_ids,
      }
    })()

  return {
    project_directory: projectDirectory,
    updated_at: new Date().toISOString(),
    ...(activeMissionId && { active_mission_id: activeMissionId }),
    ...(lingeringMissionId && { lingering_mission_id: lingeringMissionId }),
    ...(runningIds.length > 0 && { running_mission_ids: runningIds }),
    ...(retroIds.length > 0 && { retro_mission_ids: retroIds }),
    missions,
    agents,
    ...(tree && { tree }),
    skills,
    session_status: sessionStatus,
    opencode_reachable: reachable,
    ...(retro && { retro }),
    ...(layoutSpec && {
      office_layout: {
        revision: layoutSpec.revision,
        workstation_count: layoutSpec.workstation_count,
        ready: officeLayoutReady,
        bindings: layoutSpec.bindings,
        ...(layoutManifest?.warnings && layoutManifest.warnings.length > 0 && { warnings: layoutManifest.warnings }),
      },
    }),
    trees_index: treesIndex.trees,
  } satisfies PortalSnapshot & { trees_index: typeof treesIndex.trees }
}

const OUTER_PROFILE_SKILLS: Record<string, string[]> = {
  lead: ["planning-skill"],
  architect: ["meta-skill", "retro-toolkit"],
  curator: ["meta-skill"],
  arbiter: ["meta-skill"],
}

async function readOpencodeAgentDescriptions(_projectDirectory: string) {
  const dir = globalOpencodeAgentDir()
  const descriptions = new Map<string, string>()
  if (!existsSync(dir)) return descriptions
  for await (const file of new Bun.Glob("*.md").scan({ cwd: dir, onlyFiles: true })) {
    const profile = path.basename(file, ".md")
    const text = await Bun.file(path.join(dir, file)).text()
    const description = readFrontmatterDescription(text)
    if (description) descriptions.set(profile, description)
  }
  return descriptions
}

function readFrontmatterDescription(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return undefined
  const line = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  return line?.replace(/^["']|["']$/g, "")
}

function agentPortalMeta(
  agent: RegistryAgent,
  tree: PortalTree | undefined,
  skills: PortalSkill[],
  descriptions: Map<string, string>,
) {
  if (agent.scope === "outer") {
    return {
      description: descriptions.get(agent.profile),
      skills: OUTER_PROFILE_SKILLS[agent.profile] ?? [],
    }
  }
  const missionTree = tree?.mission_id === agent.missionId ? tree : undefined
  const node = missionTree?.nodes.find((entry) => entry.node_id === agent.nodeId)
  const domain = node?.skill_domain
  return {
    description: node?.description ?? node?.display_name,
    skills: domain ? skills.filter((skill) => skill.domain === domain).map((skill) => skill.name) : [],
  }
}

function mapRegistryAgentToPortalAgent(input: {
  agent: RegistryAgent
  tree: PortalTree | undefined
  skills: PortalSkill[]
  agentDescriptions: Map<string, string>
  agentNames: ReturnType<typeof readAgentNamesSync>
  sync: ReturnType<typeof agentSync>
  sessionStatus: Record<string, string>
  reachable: boolean
  lingering?: boolean
}) {
  const spawn_id = spawnIdForAgent(input.agent)
  const meta = agentPortalMeta(input.agent, input.tree, input.skills, input.agentDescriptions)
  const treeNode =
    input.tree && input.agent.nodeId && input.tree.mission_id === input.agent.missionId
      ? input.tree.nodes.find((entry) => entry.node_id === input.agent.nodeId)
      : undefined
  const display_name =
    input.agent.scope === "outer"
      ? (() => {
          const profile = normalizeOuterProfile(input.agent.profile)
          return profile ? agentName(input.agentNames, profile) : input.agent.displayName
        })()
      : input.agent.nodeId
        ? (treeNode?.display_name ?? portalNodeDisplayName(input.agent.nodeId, input.agent.displayName))
        : input.agent.displayName
  return {
    agent_id: input.agent.agentId,
    scope: input.agent.scope,
    profile: input.agent.profile,
    display_name,
    session_id: input.agent.sessionId,
    ...(input.agent.missionId && { mission_id: input.agent.missionId }),
    ...(input.agent.nodeId && { node_id: input.agent.nodeId }),
    status: input.lingering
      ? ("idle" as const)
      : input.sync.resolveSnapshotStatus(spawn_id, input.agent.sessionId, input.sessionStatus, input.reachable),
    spawn_id,
    ...(meta.description && { description: meta.description }),
    ...(meta.skills.length > 0 && { skills: meta.skills }),
    ...(input.lingering && { lingering: true }),
  }
}

const portalSnapshotCache = createPortalDataCache<
  Awaited<ReturnType<typeof buildPortalSnapshot>>
>({ ttlMs: portalCacheTtlMs("GATEHOUSE_PORTAL_SNAPSHOT_TTL_MS", 5_000) })

function portalSnapshotCacheKey(projectDirectory: string, opencodeUrl?: string) {
  return `${projectDirectory}\0${opencodeUrl ?? ""}`
}

export async function getCachedPortalSnapshot(projectDirectory: string, opencodeUrl?: string) {
  const key = portalSnapshotCacheKey(projectDirectory, opencodeUrl)
  return portalSnapshotCache.get(key, () => buildPortalSnapshot(projectDirectory, opencodeUrl))
}

export function clearPortalSnapshotCacheForTests() {
  portalSnapshotCache.clear()
}

export function portalSnapshotCacheAgeMs() {
  return portalSnapshotCache.cacheAgeMs()
}
