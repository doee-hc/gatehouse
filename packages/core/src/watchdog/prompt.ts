import { RegistryDatabase } from "../registry/db.ts"
import {
  curatorSkillSummaryRelPath,
  nodeDeliveryRelPath,
  retroNodeReportRelPath,
  treeRelDir,
  watchdogNodeWakePromptPath,
  watchdogRetroRecordWakePromptPath,
  watchdogSkillRecordWakePromptPath,
} from "../paths.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"

export {
  WATCHDOG_IDLE_THRESHOLD_MS,
  WATCHDOG_POLL_MS,
  WATCHDOG_WAKE_COOLDOWN_MS,
} from "./tick.ts"

export async function loadWatchdogNodeWakePrompt(
  projectDirectory: string,
  input: { missionId: string; nodeId: string; idleSeconds: number; rootNodeId: string },
) {
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogNodeWakePromptPath(projectDirectory)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const isRoot = input.nodeId === input.rootNodeId
  const deliveryPath = isRoot
    ? `${treeRelDir(input.missionId)}/reports/root-delivery.md`
    : nodeDeliveryRelPath(input.missionId, input.nodeId)
  return template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{node_id}}", input.nodeId)
    .replaceAll("{{idle_seconds}}", String(input.idleSeconds))
    .replaceAll("{{delivery_path}}", deliveryPath)
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

export function listRunningMissionIds(projectDirectory: string) {
  return new RegistryDatabase(projectDirectory, { readonly: true }).listTreeMissionIds("running")
}
