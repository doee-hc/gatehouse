import type { BlogSnapshot } from "./blog.ts"
import { resolvePortalProjectSlug } from "./portal-project.ts"
import type { PortalSnapshot, PortalAgent, PortalTree, PortalTreeNode } from "./snapshot.ts"
import type { TeamStatsSnapshot, TeamStatsMission, TeamStatsOuterRole, TeamStatsRole } from "./team-stats.ts"
import type { PortalSkillDetail } from "./skill.ts"

export type BrowserPortalAgent = Omit<PortalAgent, "session_id">
export type BrowserPortalTreeNode = Omit<PortalTreeNode, "session_id">
export type BrowserPortalTree = Omit<PortalTree, "nodes"> & { nodes: BrowserPortalTreeNode[] }

export type BrowserPortalSnapshot = Omit<
  PortalSnapshot,
  "project_directory" | "session_status" | "agents" | "tree" | "trees"
> & {
  project: string
  agents: BrowserPortalAgent[]
  tree?: BrowserPortalTree
  trees?: BrowserPortalTree[]
}

export type BrowserTeamStatsRole = Omit<TeamStatsRole, "session_id">
export type BrowserTeamStatsOuterRole = Omit<TeamStatsOuterRole, "session_id">
export type BrowserTeamStatsMission = Omit<TeamStatsMission, "roles"> & {
  roles: BrowserTeamStatsRole[]
}

export type BrowserTeamStatsSnapshot = Omit<TeamStatsSnapshot, "project_directory" | "outer" | "missions"> & {
  project: string
  outer: BrowserTeamStatsOuterRole[]
  missions: BrowserTeamStatsMission[]
}

export type BrowserBlogSnapshot = Omit<BlogSnapshot, "project_directory"> & {
  project: string
}

export type BrowserPortalSkillDetail = PortalSkillDetail

function browserProject(projectDirectory: string) {
  return resolvePortalProjectSlug(projectDirectory)
}

function stripAgent(agent: PortalAgent): BrowserPortalAgent {
  const { session_id: _sessionId, ...rest } = agent
  return rest
}

function stripTree(value: PortalTree): BrowserPortalTree {
  const { nodes, ...treeRest } = value
  return {
    ...treeRest,
    nodes: nodes.map((node) => {
      const { session_id: _sessionId, ...nodeRest } = node
      return nodeRest
    }),
  }
}

export function toBrowserSnapshot(projectDirectory: string, snapshot: PortalSnapshot): BrowserPortalSnapshot {
  const {
    project_directory: _projectDirectory,
    session_status: _sessionStatus,
    agents,
    tree,
    trees,
    ...rest
  } = snapshot

  return {
    ...rest,
    project: browserProject(projectDirectory),
    agents: agents.map(stripAgent),
    ...(tree && { tree: stripTree(tree) }),
    ...(trees && { trees: trees.map(stripTree) }),
  }
}

export function toBrowserTeamStats(
  projectDirectory: string,
  stats: TeamStatsSnapshot,
): BrowserTeamStatsSnapshot {
  const { project_directory: _projectDirectory, outer, missions, ...rest } = stats
  return {
    ...rest,
    project: browserProject(projectDirectory),
    outer: outer.map(({ session_id: _sessionId, ...role }) => role),
    missions: missions.map(({ roles, ...mission }) => ({
      ...mission,
      roles: roles.map(({ session_id: _sessionId, ...role }) => role),
    })),
  }
}

export function toBrowserBlog(projectDirectory: string, blog: BlogSnapshot): BrowserBlogSnapshot {
  const { project_directory: _projectDirectory, ...rest } = blog
  return {
    ...rest,
    project: browserProject(projectDirectory),
  }
}

export function toBrowserSkillDetail(detail: PortalSkillDetail): BrowserPortalSkillDetail {
  return detail
}
