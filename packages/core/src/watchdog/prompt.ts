import { RegistryDatabase } from "../registry/db.ts"
import {
  curatorSkillSummaryRelPath,
  retroNodeReportRelPath,
  watchdogNodeWakePromptPath,
  autopilotWakePromptPath,
  autopilotEnabledPromptPath,
  watchdogOrchestratorStallPromptPath,
  watchdogRetroRecordWakePromptPath,
  watchdogSkillRecordWakePromptPath,
  watchdogSkillVerifyRecordWakePromptPath,
  skillVerifyReportRelPath,
} from "../paths.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"

export {
  WATCHDOG_IDLE_THRESHOLD_MS,
  WATCHDOG_POLL_MS,
  WATCHDOG_WAKE_COOLDOWN_MS,
} from "./tick.ts"

export async function loadWatchdogNodeWakePrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; idleSeconds: number },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogNodeWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{idle_seconds}}", String(input.idleSeconds))
}

export async function loadWatchdogRetroRecordWakePrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; idleSeconds: number },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogRetroRecordWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const reportPath = retroNodeReportRelPath(input.missionId, input.nodeId)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{idle_seconds}}", String(input.idleSeconds))
    .replaceAll("{{report_path}}", reportPath)
}

export async function loadWatchdogSkillRecordWakePrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; idleSeconds: number },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogSkillRecordWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const summaryPath = curatorSkillSummaryRelPath(input.missionId, input.nodeId)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{idle_seconds}}", String(input.idleSeconds))
    .replaceAll("{{summary_path}}", summaryPath)
}

export async function loadWatchdogSkillVerifyRecordWakePrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; idleSeconds: number },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogSkillVerifyRecordWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const reportPath = skillVerifyReportRelPath(input.missionId, input.nodeId)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{idle_seconds}}", String(input.idleSeconds))
    .replaceAll("{{report_path}}", reportPath)
}

export function listRunningMissionIds(projectDirectory: string) {
  return new RegistryDatabase(projectDirectory, { readonly: true }).listTreeMissionIds("running")
}

export async function loadWatchdogOrchestratorStallPrompt(
  projectDirectory: string,
  input: {
    missionId: string
    phase: string
    staleMinutes: number
    stallKindLabel: string
  },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogOrchestratorStallPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{phase}}", input.phase)
    .replaceAll("{{stale_minutes}}", String(input.staleMinutes))
    .replaceAll("{{stall_kind_label}}", input.stallKindLabel)
}

export async function loadAutopilotWakePrompt(projectDirectory: string) {
  return renderGatehouseTemplate(
    await Bun.file(autopilotWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
}

export async function loadAutopilotEnabledPrompt(projectDirectory: string) {
  return renderGatehouseTemplate(
    await Bun.file(autopilotEnabledPromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
}
