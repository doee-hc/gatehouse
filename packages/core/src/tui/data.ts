import { existsSync } from "node:fs"
import type { MissionEntry } from "../missions/parse.ts"
import { readMissionsDocumentSync } from "../missions/store.ts"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryAgent } from "../registry/types.ts"
import { readPortalRuntimeSync, type PortalRuntimeInfo } from "../portal/runtime-info.ts"
import { gatehouseRoot } from "../paths.ts"
import { readManifestSync, readTreesIndexSync } from "../tree/store.ts"
import type { TreeManifest } from "../tree/types.ts"
import { readAutopilotDocumentSync, autopilotIsEnabled } from "../lead/autopilot.ts"
import { readDirectionDocumentSync, directionIsConfirmed } from "../lead/direction.ts"

export type GatehouseOuterAgentRow = {
  displayName: string
  profile: string
  sessionId: string
}

export type GatehouseMissionRow = {
  missionId: string
  status: string
  objective?: string
}

export type GatehouseTreePanel = {
  missionId: string
  status: string
  lines: string[]
}

export type GatehouseSidebarState = {
  outerAgents: GatehouseOuterAgentRow[]
  missions: GatehouseMissionRow[]
  trees: GatehouseTreePanel[]
  sessionOwner?: GatehouseOuterAgentRow
  portal?: PortalRuntimeInfo
  autopilot?: {
    enabled: boolean
    directionConfirmed: boolean
  }
}

function outerRow(agent: RegistryAgent): GatehouseOuterAgentRow {
  return {
    displayName: agent.displayName,
    profile: agent.profile,
    sessionId: agent.sessionId,
  }
}

export function treeManifestLines(manifest: TreeManifest) {
  return Object.entries(manifest.nodes)
    .sort(([left], [right]) => {
      if (left === manifest.terminal_node) return -1
      if (right === manifest.terminal_node) return 1
      return left.localeCompare(right)
    })
    .map(([nodeId, node]) =>
      node.description
        ? `${nodeId} · ${node.description}`
        : node.display_name
          ? `${nodeId} · ${node.display_name}`
          : nodeId,
    )
}

function missionSortTime(mission: MissionEntry) {
  const value = mission.completed_at ?? mission.started_at
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function loadGatehouseSidebarStateSync(
  projectDirectory: string,
  sessionId?: string,
): GatehouseSidebarState | undefined {
  const directory = projectDirectory.trim()
  if (!directory || !existsSync(gatehouseRoot(directory))) return undefined

  const registry = new RegistryDatabase(directory, { readonly: true })
  const snapshot = registry.load()
  const outerAgents = snapshot.agents
    .filter((agent) => agent.scope === "outer" && agent.status === "active")
    .map(outerRow)

  const missionsDoc = readMissionsDocumentSync(directory)
  const missions = [...missionsDoc.missions]
    .sort((a, b) => missionSortTime(b) - missionSortTime(a))
    .slice(0, 6)
    .map((mission) => ({
      missionId: mission.id,
      status: mission.status,
      ...(mission.objective && { objective: mission.objective }),
    }))

  const treesIndex = readTreesIndexSync(directory)
  const trees = treesIndex.trees
    .filter((entry) => missionsDoc.missions.find((mission) => mission.id === entry.mission_id)?.status === "running")
    .slice(0, 2)
    .flatMap((entry) => {
      const manifest = readManifestSync(directory, entry.mission_id)
      if (!manifest) return []
      return [
        {
          missionId: entry.mission_id,
          status: manifest.status,
          lines: treeManifestLines(manifest),
        },
      ]
    })

  const owner = sessionId
    ? snapshot.agents.find((agent) => agent.sessionId === sessionId && agent.scope === "outer")
    : undefined

  const portal = readPortalRuntimeSync(directory)
  const autopilotDoc = readAutopilotDocumentSync(directory)
  const directionDoc = readDirectionDocumentSync(directory)

  return {
    outerAgents,
    missions,
    trees,
    ...(owner && { sessionOwner: outerRow(owner) }),
    ...(portal && { portal }),
    autopilot: {
      enabled: autopilotIsEnabled(autopilotDoc),
      directionConfirmed: directionIsConfirmed(directionDoc),
    },
  }
}

export async function loadGatehouseSidebarState(
  projectDirectory: string,
  sessionId?: string,
): Promise<GatehouseSidebarState | undefined> {
  return loadGatehouseSidebarStateSync(projectDirectory, sessionId)
}
