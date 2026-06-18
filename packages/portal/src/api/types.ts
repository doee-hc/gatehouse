import { characterAtlasPrefix, type CharacterAtlasPrefix } from "../office/characters.ts"

export type PortalMission = {
  id: string
  status: string
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
  parent: string | null
  skill_domain?: string
  display_name: string
  description?: string
}

export type PortalOrchestrationNodeStatus = "pending" | "running" | "done" | "blocked" | "rework"

export type PortalOrchestrationNode = {
  node_id: string
  display_name: string
  parent: string | null
  skill_domain?: string
  status: PortalOrchestrationNodeStatus
  round?: number
}

export type PortalOrchestrationPhase = {
  title: string
  state: "done" | "current" | "pending"
}

export type PlanStepOp = "run" | "fork" | "other"

export type PortalOrchestrationStep = {
  id: string
  op: PlanStepOp
  state: "done" | "current" | "pending"
  node_id?: string
}

export type PortalOrchestrationFlowEdge = {
  step_id: string
  from: string
  to: string
  op: PlanStepOp
  state: "done" | "current" | "pending"
  kind?: "activate" | "rollup" | "serial" | "depends"
}

export type PortalOrchestration = {
  mission_id: string
  active: boolean
  phase?: string
  sandbox_status?: string
  cursor_step_index: number
  total_steps: number
  completed_steps: number
  phases: PortalOrchestrationPhase[]
  steps: PortalOrchestrationStep[]
  flow_edges: PortalOrchestrationFlowEdge[]
  nodes: PortalOrchestrationNode[]
  root_node: string
}

export type PortalDirection = {
  status: "draft" | "confirmed"
  confirmed: boolean
  summary?: string
  constraints: string[]
  confirmed_at?: string
  review_after?: string
}

export type PortalAgent = {
  agent_id: string
  scope: "outer" | "inner" | "retro"
  profile: string
  display_name: string
  mission_id?: string
  node_id?: string
  status: "idle" | "busy" | "research"
  spawn_id: string
  description?: string
  skills?: string[]
  lingering?: boolean
}

export type PortalSnapshot = {
  project: string
  updated_at: string
  active_mission_id?: string
  lingering_mission_id?: string
  running_mission_ids?: string[]
  retro_mission_ids?: string[]
  missions: PortalMission[]
  agents: PortalAgent[]
  tree?: {
    mission_id: string
    root_node: string
    status: string
    nodes: PortalTreeNode[]
  }
  trees?: Array<{
    mission_id: string
    root_node: string
    status: string
    nodes: PortalTreeNode[]
  }>
  skills: PortalSkill[]
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
    summary_submitted: boolean
    architect_review_pending: boolean
  }
  orchestration?: PortalOrchestration
  direction?: PortalDirection
}

export type BlogPostFormat = "markdown" | "html"

export type BlogPost = {
  id: string
  title: string
  excerpt: string
  format?: BlogPostFormat
  markdown: string
  path: string
  updated_at: string
}

export type BlogGroup = {
  kind: "mission" | "team-building"
  id: string
  title: string
  objective?: string
  completed_at?: string
  post_count: number
  expanded: boolean
  posts: BlogPost[]
}

export type BlogSnapshot = {
  project: string
  updated_at: string
  groups: BlogGroup[]
}

export type TeamStatsTokenBreakdown = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
  total: number
}

export type TeamStatsRole = {
  node_id: string
  label: string
  tokens: TeamStatsTokenBreakdown
  cost: number
  duration_ms: number
}

export type TeamStatsMission = {
  id: string
  status: string
  objective?: string
  started_at?: string
  completed_at?: string
  tokens: TeamStatsTokenBreakdown
  cost: number
  duration_ms: number
  wall_clock_ms?: number
  roles: TeamStatsRole[]
}

export type TeamStatsOuterRole = {
  profile: string
  label: string
  tokens: TeamStatsTokenBreakdown
  cost: number
  duration_ms: number
}

export type TeamStatsSnapshot = {
  project: string
  updated_at: string
  opencode_reachable: boolean
  outer: TeamStatsOuterRole[]
  missions: TeamStatsMission[]
}

export type OfficeAgentDef = {
  id: string
  name: string
  atlasPrefix: CharacterAtlasPrefix
  status: PortalAgent["status"]
  spawnId: string
  fixed?: boolean
  ghost?: boolean
}

export function officeAgentsFromSnapshot(snapshot: PortalSnapshot) {
  if (snapshot.agents.length === 0) return [] as OfficeAgentDef[]

  const nodeNames = new Map<string, string>()
  for (const tree of snapshot.trees ?? (snapshot.tree ? [snapshot.tree] : [])) {
    for (const node of tree.nodes) {
      nodeNames.set(`${tree.mission_id}:${node.node_id}`, node.display_name)
    }
  }

  return snapshot.agents.map((agent) => ({
    id: agent.spawn_id,
    name:
      (agent.mission_id &&
        agent.node_id &&
        nodeNames.get(`${agent.mission_id}:${agent.node_id}`)) ||
      agent.display_name,
    atlasPrefix: characterAtlasPrefix(agent),
    status: agent.status,
    spawnId: agent.spawn_id,
    fixed: agent.scope === "outer",
    ghost: agent.scope === "retro" || agent.lingering === true,
  }))
}

export function portalStatusFromSession(raw: string | undefined): AgentStatusFromSession {
  if (raw === "busy" || raw === "retry") return "busy"
  if (raw === "blocked") return "blocked"
  return "idle"
}

export type AgentStatusFromSession = PortalAgent["status"] | "blocked"
