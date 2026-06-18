export type TreeNode = {
  session_id: string
  parent: string | null
  display_name?: string
  /** One-line role summary for UI and gatehouse_list_team (execution view) */
  description?: string
  /** OpenCode profile (build). */
  profile?: string
  /** Skill extract domain; curator gatehouse_apply_skill_domains writes manifest */
  skill_domain?: string
}

export type TreeManifest = {
  mission_id: string
  status: "running" | "archived"
  root_node: string
  created_at: string
  archived_at?: string
  nodes: Record<string, TreeNode>
}

export type RetroManifest = {
  mission_id: string
  created_at: string
  retro_session_id: string
  analysis_order: string[]
}

export type ExtractManifestNode = {
  exec_session_id: string
  extract_session_id: string
  skill_domain: string
}

export type ExtractManifest = {
  mission_id: string
  created_at: string
  nodes: Record<string, ExtractManifestNode>
  extract_order: string[]
}

export type VerifyManifestNode = {
  extract_session_id: string
  verify_session_id: string
  skill_domain: string
}

export type VerifyManifest = {
  mission_id: string
  created_at: string
  nodes: Record<string, VerifyManifestNode>
  verify_order: string[]
}

export type TeamSpecNode = {
  parent: string | null
  /** One-line role summary; copied into manifest at bootstrap */
  description: string
  /** Curator apply_skill_domains writes before bootstrap; copied into manifest at bootstrap */
  skill_domain?: string
}

export type TeamSpec = {
  mission_id: string
  root: string
  nodes: Record<string, TeamSpecNode>
}

export type TreesIndexEntry = {
  mission_id: string
  root_session_id: string
  root_node: string
  status: string
  created_at: string
  objective?: string
}

export type TreesIndex = {
  trees: TreesIndexEntry[]
}

/** Full manifest row (internal). Agent-facing list uses ListTreeTeammate in tools/list-views.ts. */
export type TreeMember = {
  node_id: string
  session_id: string
  parent: string | null
  child_nodes: string[]
  display_name?: string
  description?: string
  profile?: string
}

export type ListScope = "all" | "children" | "siblings"
