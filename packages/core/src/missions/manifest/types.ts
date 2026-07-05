export type MissionNode = {
  session_id: string
  display_name?: string
  /** One-line role summary for UI and gatehouse_list_team (execution view) */
  description?: string
  /** OpenCode profile (build). */
  profile?: string
  /** Skill extract domain; curator gatehouse_apply_skill_domains writes manifest */
  skill_domain?: string
}

export type MissionManifest = {
  mission_id: string
  status: "running" | "archived"
  terminal_node: string
  created_at: string
  archived_at?: string
  nodes: Record<string, MissionNode>
}

export type MissionRetroManifest = {
  mission_id: string
  created_at: string
  retro_session_id: string
  analysis_order: string[]
}

export type MissionMissionExtractManifestNode = {
  exec_session_id: string
  extract_session_id: string
  skill_domain: string
}

export type MissionExtractManifest = {
  mission_id: string
  created_at: string
  nodes: Record<string, MissionMissionExtractManifestNode>
  extract_order: string[]
}

export type MissionMissionVerifyManifestNode = {
  extract_session_id: string
  verify_session_id: string
  skill_domain: string
}

export type MissionVerifyManifest = {
  mission_id: string
  created_at: string
  nodes: Record<string, MissionMissionVerifyManifestNode>
  verify_order: string[]
}

export type MissionMissionTeamSpecNode = {
  /** One-line role summary; copied into manifest at bootstrap */
  description: string
  /** Curator apply_skill_domains writes before bootstrap; copied into manifest at bootstrap */
  skill_domain?: string
}

export type MissionTeamSpec = {
  mission_id: string
  terminal: string
  nodes: Record<string, MissionMissionTeamSpecNode>
}

export type MissionManifestIndexEntry = {
  mission_id: string
  terminal_session_id: string
  terminal_node: string
  status: string
  created_at: string
  objective?: string
}

export type MissionManifestIndex = {
  missions: MissionManifestIndexEntry[]
}

/** Full manifest row (internal). Agent-facing list uses ListExecutionMember in tools/list-views.ts. */
export type MissionMember = {
  node_id: string
  session_id: string
  display_name?: string
  description?: string
  profile?: string
}
