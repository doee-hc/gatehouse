import {
  GATEHOUSE_RETRO_TOOLKIT_SKILL,
  innerExecutionSkillPermissions,
  innerPipelineSkillPermissions,
  outerProfileSkillPermissions,
} from "../skills/constants.ts"
import {
  architectFilesystemPermissions,
  arbiterFilesystemPermissions,
  curatorFilesystemPermissions,
  innerExecutionFilesystemPermissions,
  innerPipelineFilesystemPermissions,
  innerRetroAnalystFilesystemPermissions,
  leadFilesystemPermissions,
} from "./gatehouse-path-permissions.ts"

type PermissionValue = string | Record<string, string>
export type AgentPermissionMap = Record<string, PermissionValue>

/** Single source for Gatehouse agent tool permissions (merged by applyGatehouseConfig). */

/** Merged into opencode.json top-level `permission` — extract/verify sessions only. */
export const globalGatehousePermissions = {} as const

/** Leaf build — no peer coordination or orchestration reads. */
const innerLeafGatehouseDenials = {
  gatehouse_send_message: "deny",
  gatehouse_list_team: "deny",
  gatehouse_session_snapshot: "deny",
  gatehouse_retro_record: "deny",
  gatehouse_retro_summary_record: "deny",
  gatehouse_skill_summary_record: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_submit_orchestration: "deny",
  gatehouse_init_team: "deny",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_direction_status: "deny",
} as const

/** Extract / verify — single record tool plus filesystem reads; deny all other Gatehouse tools. */
const innerPipelineGatehouseDenials = {
  gatehouse_init_team: "deny",
  gatehouse_submit_orchestration: "deny",
  gatehouse_list_team: "deny",
  gatehouse_send_message: "deny",
  gatehouse_session_snapshot: "deny",
  gatehouse_mission_start: "deny",
  gatehouse_mission_info: "deny",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_retro_record: "deny",
  gatehouse_retro_summary_record: "deny",
  gatehouse_skill_summary_record: "deny",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_delivery_review: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_direction_status: "deny",
} as const

const innerExtractGatehousePermissions = {
  gatehouse_skill_extract_record: "allow",
  gatehouse_skill_verify_record: "deny",
  ...innerPipelineGatehouseDenials,
} as const

const innerVerifyGatehousePermissions = {
  gatehouse_skill_verify_record: "allow",
  gatehouse_skill_extract_record: "deny",
  ...innerPipelineGatehouseDenials,
} as const

/** Retro analyst session — write retro-summary, read context, evolve retro-toolkit. */
const innerRetroAnalystGatehousePermissions = {
  gatehouse_retro_record: "allow",
} as const

const innerRetroAnalystPipelineDenials = {
  gatehouse_init_team: "deny",
  gatehouse_submit_orchestration: "deny",
  gatehouse_list_team: "deny",
  gatehouse_send_message: "deny",
  gatehouse_session_snapshot: "deny",
  gatehouse_mission_start: "deny",
  gatehouse_mission_info: "deny",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_retro_summary_record: "deny",
  gatehouse_skill_summary_record: "deny",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_delivery_review: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_direction_status: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_unpublish_blog: "deny",
  gatehouse_inspector_queue: "deny",
  gatehouse_inspector_decide: "deny",
} as const

/** Mission lifecycle — outer core team only; hidden from execution profiles. */
const innerMissionLifecycleDenials = {
  gatehouse_mission_start: "deny",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_delivery_review: "deny",
} as const

const nonArbiterInspectorDenials = {
  gatehouse_inspector_queue: "deny",
  gatehouse_inspector_decide: "deny",
} as const

/** Retro sessions only — deny on all outer core-team profiles. */
const outerRetroRecordDenials = {
  gatehouse_retro_record: "deny",
} as const

/** Architect retro summary — architect only. */
const outerRetroSummaryRecordDenials = {
  gatehouse_retro_summary_record: "deny",
} as const

/** Curator skill summary — curator only. */
const outerSkillSummaryRecordDenials = {
  gatehouse_skill_summary_record: "deny",
} as const

export const leadPermissions = {
  ...leadFilesystemPermissions,
  skill: outerProfileSkillPermissions("lead"),
  task: "deny",
  gatehouse_init_team: "allow",
  gatehouse_submit_orchestration: "deny",
  gatehouse_send_message: "allow",
  gatehouse_mission_start: "allow",
  gatehouse_mission_info: "allow",
  gatehouse_mission_retro: "allow",
  gatehouse_mission_complete: "allow",
  gatehouse_list_team: "allow",
  gatehouse_session_snapshot: "allow",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_unpublish_blog: "allow",
  gatehouse_delivery_review: "allow",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "allow",
  gatehouse_direction_status: "allow",
  ...outerRetroRecordDenials,
  ...outerRetroSummaryRecordDenials,
  ...outerSkillSummaryRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

export const architectSessionPermissions = {
  ...architectFilesystemPermissions,
  skill: outerProfileSkillPermissions("architect"),
  task: "deny",
  gatehouse_init_team: "deny",
  gatehouse_submit_orchestration: "allow",
  gatehouse_send_message: "allow",
  gatehouse_list_team: "allow",
  gatehouse_mission_start: "deny",
  gatehouse_mission_info: "allow",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_session_snapshot: "allow",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_unpublish_blog: "deny",
  gatehouse_delivery_review: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "allow",
  gatehouse_direction_status: "deny",
  gatehouse_retro_summary_record: "allow",
  ...outerRetroRecordDenials,
  ...outerSkillSummaryRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

export const curatorSessionPermissions = {
  ...curatorFilesystemPermissions,
  skill: outerProfileSkillPermissions("curator"),
  task: "deny",
  gatehouse_init_team: "deny",
  gatehouse_submit_orchestration: "deny",
  gatehouse_send_message: "allow",
  gatehouse_list_team: "allow",
  gatehouse_apply_skill_domains: "allow",
  gatehouse_mission_start: "deny",
  gatehouse_mission_info: "allow",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  gatehouse_session_snapshot: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_unpublish_blog: "deny",
  gatehouse_delivery_review: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_direction_status: "deny",
  gatehouse_skill_summary_record: "allow",
  ...outerRetroRecordDenials,
  ...outerRetroSummaryRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

/** Inner execution nodes — mission lifecycle hidden; delivery uses execution_complete + system notify. */
export const buildExecutionPermissions = {
  ...innerExecutionFilesystemPermissions,
  skill: innerExecutionSkillPermissions(),
  question: "allow",
  plan_enter: "allow",
  task: "allow",
  gatehouse_execution_complete: "allow",
  gatehouse_execution_rework: "allow",
  gatehouse_mission_info: "allow",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_unpublish_blog: "deny",
  ...innerLeafGatehouseDenials,
  ...innerMissionLifecycleDenials,
  ...nonArbiterInspectorDenials,
} as const

/** Retro analyst — architect assistant; empty context mission retro. */
export const retroAnalystPermissions = {
  ...innerRetroAnalystFilesystemPermissions,
  skill: {
    "*": "deny" as const,
    "retro-analyst-meta": "allow" as const,
    [GATEHOUSE_RETRO_TOOLKIT_SKILL]: "allow" as const,
  },
  question: "allow",
  plan_enter: "allow",
  task: "deny",
  ...innerRetroAnalystGatehousePermissions,
  ...innerRetroAnalystPipelineDenials,
  ...nonArbiterInspectorDenials,
} as const

export const buildExtractPermissions = {
  ...innerPipelineFilesystemPermissions,
  skill: innerPipelineSkillPermissions(),
  question: "deny",
  plan_enter: "deny",
  task: "deny",
  bash: "deny",
  gatehouse_unpublish_blog: "deny",
  ...innerExtractGatehousePermissions,
  ...nonArbiterInspectorDenials,
} as const

export const buildVerifyPermissions = {
  ...innerPipelineFilesystemPermissions,
  skill: innerPipelineSkillPermissions(),
  question: "deny",
  plan_enter: "deny",
  task: "deny",
  bash: "deny",
  gatehouse_unpublish_blog: "deny",
  ...innerVerifyGatehousePermissions,
  ...nonArbiterInspectorDenials,
} as const

export const arbiterSessionPermissions = {
  ...arbiterFilesystemPermissions,
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
  gatehouse_submit_orchestration: "deny",
  gatehouse_send_message: "deny",
  gatehouse_mission_start: "deny",
  gatehouse_mission_info: "deny",
  gatehouse_mission_retro: "deny",
  gatehouse_mission_complete: "deny",
  ...outerRetroRecordDenials,
  ...outerRetroSummaryRecordDenials,
  ...outerSkillSummaryRecordDenials,
  gatehouse_apply_skill_domains: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_list_team: "allow",
  gatehouse_session_snapshot: "allow",
  gatehouse_inspector_queue: "allow",
  gatehouse_inspector_decide: "allow",
  gatehouse_unpublish_blog: "deny",
  gatehouse_delivery_review: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_direction_status: "deny",
} as const

export const agentPermissionByAgentFile: Record<string, AgentPermissionMap> = {
  "lead.md": leadPermissions,
  "architect.md": architectSessionPermissions,
  "curator.md": curatorSessionPermissions,
  "arbiter.md": arbiterSessionPermissions,
  "build-extract.md": buildExtractPermissions,
  "build-verify.md": buildVerifyPermissions,
  "build.md": buildExecutionPermissions,
  "retro-analyst.md": retroAnalystPermissions,
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
