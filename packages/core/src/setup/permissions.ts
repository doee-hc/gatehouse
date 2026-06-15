import {
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
  innerRetroFilesystemPermissions,
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
  gatehouse_delivery_status: "deny",
  gatehouse_submit_orchestration: "deny",
  gatehouse_init_team: "deny",
  gatehouse_apply_skill_domains: "deny",
  gatehouse_direction_status: "deny",
} as const

/** Intermediate coordinators — structural root only for delivery / orchestration reads. */
const innerNonStructuralRootDenials = {
  gatehouse_execution_status: "deny",
  gatehouse_delivery_status: "deny",
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
  gatehouse_delivery_status: "deny",
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

/** Inner profiles never expose send_message — delivery uses execution_complete + system notify. */
const innerSendMessageDenials = {
  gatehouse_send_message: "deny",
} as const

/** Gatehouse coordination tools for inner coordinators (build-root / build-coordinator; not leaf build). */
const innerExecutionGatehousePermissions = {
  gatehouse_list_team: "allow",
  gatehouse_session_snapshot: "deny",
  gatehouse_skill_extract_record: "deny",
  gatehouse_skill_verify_record: "deny",
  gatehouse_execution_complete: "allow",
  gatehouse_execution_rework: "allow",
  gatehouse_mission_info: "allow",
} as const

/** Retro sessions (managerRetroOrder nodes → build-root / build-coordinator). */
const innerRetroGatehousePermissions = {
  gatehouse_retro_record: "allow",
} as const

/** Mission lifecycle — outer core team only; hidden from execution profiles (root / coordinators). */
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

/** Curator skill rollup summary — curator only. */
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
  gatehouse_delivery_status: "allow",
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
  gatehouse_delivery_status: "allow",
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
  gatehouse_delivery_status: "deny",
  gatehouse_execution_complete: "deny",
  gatehouse_execution_rework: "deny",
  gatehouse_execution_status: "deny",
  gatehouse_direction_status: "deny",
  gatehouse_skill_summary_record: "allow",
  ...outerRetroRecordDenials,
  ...outerRetroSummaryRecordDenials,
  ...nonArbiterInspectorDenials,
} as const

/** Leaf execution (OpenCode build) — mission lifecycle hidden; no peer coordination. */
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

const innerCoordinatorPermissions = {
  ...innerRetroFilesystemPermissions,
  skill: innerExecutionSkillPermissions(),
  question: "allow",
  plan_enter: "allow",
  task: "deny",
  gatehouse_unpublish_blog: "deny",
  ...innerSendMessageDenials,
  ...innerExecutionGatehousePermissions,
  ...innerRetroGatehousePermissions,
  ...innerNonStructuralRootDenials,
  ...innerMissionLifecycleDenials,
  ...nonArbiterInspectorDenials,
} as const

const structuralRootDeliveryPermissions = {
  gatehouse_delivery_status: "allow",
  gatehouse_execution_status: "allow",
} as const

/** Structural root with delegates — delivery via execution_complete; task denied. */
export const buildRootPermissions = {
  ...innerCoordinatorPermissions,
  ...structuralRootDeliveryPermissions,
} as const

/** Solo structural root — delivery via execution_complete; may use task for parallel exploration. */
export const buildRootSoloPermissions = {
  ...innerCoordinatorPermissions,
  ...structuralRootDeliveryPermissions,
  task: "allow",
} as const

/** Intermediate subtree coordinator — subtree coordination via complete / rework only. */
export const buildCoordinatorPermissions = innerCoordinatorPermissions

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
  gatehouse_delivery_status: "deny",
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
  "build-root.md": buildRootPermissions,
  "build-root-solo.md": buildRootSoloPermissions,
  "build-coordinator.md": buildCoordinatorPermissions,
  "build-extract.md": buildExtractPermissions,
  "build-verify.md": buildVerifyPermissions,
  "build.md": buildExecutionPermissions,
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
