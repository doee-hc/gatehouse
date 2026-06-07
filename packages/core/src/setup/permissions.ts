import {
  innerExecutionSkillPermissions,
  outerProfileSkillPermissions,
} from "../skills/constants.ts"

type PermissionValue = string | Record<string, string>
export type AgentPermissionMap = Record<string, PermissionValue>

/** Single source for Gatehouse agent tool permissions (merged by applyGatehouseConfig). */

/** Merged into opencode.json top-level `permission` — inner exec sessions (build / build-coordinator). */
export const globalGatehousePermissions = {
  gatehouse_skill_extract_record: "allow",
} as const

/** Gatehouse coordination tools merged into profile build-coordinator only (not native build). */
const innerExecutionGatehousePermissions = {
  gatehouse_list_team: "allow",
  gatehouse_send_message: "allow",
  gatehouse_session_snapshot: "allow",
  gatehouse_skill_extract_record: "allow",
  gatehouse_publish_blog: "allow",
  gatehouse_unpublish_blog: "allow",
} as const

/** Retro fork sessions only (managerRetroOrder nodes → build-coordinator). */
const innerRetroGatehousePermissions = {
  gatehouse_retro_record: "allow",
} as const

const nonArbiterInspectorDenials = {
  gatehouse_inspector_queue: "deny",
  gatehouse_inspector_decide: "deny",
} as const

/** Retro fork sessions only — deny on all outer core-team profiles. */
const outerRetroRecordDenials = {
  gatehouse_retro_record: "deny",
} as const

export const leadPermissions = {
  skill: outerProfileSkillPermissions("lead"),
  task: "deny",
  gatehouse_init_team: "allow",
  gatehouse_bootstrap_tree: "deny",
  gatehouse_send_message: "allow",
  gatehouse_mission_start: "allow",
  gatehouse_mission_current: "allow",
  gatehouse_mission_retro: "allow",
  gatehouse_mission_complete: "allow",
  gatehouse_list_team: "allow",
  gatehouse_session_snapshot: "allow",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_publish_blog: "allow",
  gatehouse_unpublish_blog: "allow",
  ...outerRetroRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

export const architectSessionPermissions = {
  skill: outerProfileSkillPermissions("architect"),
  task: "deny",
  gatehouse_init_team: "deny",
  gatehouse_bootstrap_tree: "allow",
  gatehouse_send_message: "allow",
  gatehouse_list_team: "allow",
  gatehouse_mission_start: "deny",
  gatehouse_mission_current: "allow",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_session_snapshot: "allow",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_publish_blog: "allow",
  gatehouse_unpublish_blog: "allow",
  ...outerRetroRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

export const curatorSessionPermissions = {
  skill: outerProfileSkillPermissions("curator"),
  task: "deny",
  gatehouse_init_team: "deny",
  gatehouse_bootstrap_tree: "deny",
  gatehouse_send_message: "allow",
  gatehouse_list_team: "allow",
  gatehouse_apply_skill_domains: "allow",
  gatehouse_mission_start: "deny",
  gatehouse_mission_current: "allow",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_session_snapshot: "allow",
  gatehouse_skill_extract_record: "deny",
  gatehouse_publish_blog: "allow",
  gatehouse_unpublish_blog: "allow",
  ...outerRetroRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

export const buildCoordinatorPermissions = {
  skill: innerExecutionSkillPermissions(),
  question: "allow",
  plan_enter: "allow",
  task: "deny",
  ...innerExecutionGatehousePermissions,
  ...innerRetroGatehousePermissions,
  ...nonArbiterInspectorDenials,
} as const

export const arbiterSessionPermissions = {
  skill: outerProfileSkillPermissions("arbiter"),
  task: "deny",
  gatehouse_init_team: "deny",
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  bash: "deny",
  shell: "deny",
  edit: "deny",
  write: "deny",
  apply_patch: "deny",
  gatehouse_bootstrap_tree: "deny",
  gatehouse_send_message: "deny",
  gatehouse_mission_start: "deny",
  gatehouse_mission_current: "deny",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  ...outerRetroRecordDenials,
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  read: "allow",
  grep: "allow",
  glob: "allow",
  gatehouse_list_team: "allow",
  gatehouse_session_snapshot: "allow",
  gatehouse_inspector_queue: "allow",
  gatehouse_inspector_decide: "allow",
  gatehouse_publish_blog: "deny",
  gatehouse_unpublish_blog: "deny",
} as const

export const agentPermissionByAgentFile: Record<string, AgentPermissionMap> = {
  "lead.md": leadPermissions,
  "architect.md": architectSessionPermissions,
  "curator.md": curatorSessionPermissions,
  "arbiter.md": arbiterSessionPermissions,
  "build-coordinator.md": buildCoordinatorPermissions,
}

/** Map permission `deny` entries to legacy OpenCode `tools: false` (hide from LLM tool schema). */
export function hiddenToolsFromPermissions(permission: AgentPermissionMap) {
  const tools: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "object") continue
    if (value === "deny") tools[key] = false
  }
  return tools
}

export function agentToolsForAgentFile(agentFile: string) {
  const permission = agentPermissionByAgentFile[agentFile]
  return permission ? hiddenToolsFromPermissions(permission) : {}
}

export function permissionYamlBlock(permission: AgentPermissionMap) {
  const lines: string[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "object") {
      lines.push(`  ${key}:`)
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        lines.push(`    ${nestedKey}: ${nestedValue}`)
      }
      continue
    }
    lines.push(`  ${key}: ${value}`)
  }
  return lines.join("\n")
}

export function toolsYamlBlock(tools: Record<string, boolean>) {
  return Object.entries(tools)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join("\n")
}

export function injectAgentToolsYaml(template: string, agentFile: string) {
  const tools = agentToolsForAgentFile(agentFile)
  if (Object.keys(tools).length === 0) {
    return template.replace(/^tools:\n(?:  .+\n)+/m, "")
  }
  const block = toolsYamlBlock(tools)
  if (/^tools:\n/m.test(template)) {
    return template.replace(/^tools:\n(?:  .+\n)+/m, `tools:\n${block}\n`)
  }
  if (!/^permission:\n/m.test(template)) return template
  return template.replace(/^(permission:\n(?:  .+\n)+)/m, `$1tools:\n${block}\n`)
}

export function injectAgentPermissionYaml(template: string, agentFile: string) {
  const permission = agentPermissionByAgentFile[agentFile]
  let result = template
  if (permission) {
    const block = permissionYamlBlock(permission)
    if (/^permission:\n/m.test(result)) {
      result = result.replace(/^permission:\n(?:  .+\n)+/m, `permission:\n${block}\n`)
    }
  }
  return injectAgentToolsYaml(result, agentFile)
}
