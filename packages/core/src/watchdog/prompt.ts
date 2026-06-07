import { RegistryDatabase } from "../registry/db.ts"
import {
  curatorSkillSummaryRelPath,
  retroNodeReportRelPath,
  watchdogRetroRecordWakePromptPath,
  watchdogRootWakePromptPath,
  watchdogSkillRecordWakePromptPath,
} from "../paths.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import {
  formatExecutionTeamSnapshotFromManifest,
  formatNonRootNodeIdList,
} from "../dispatch/team-snapshot.ts"
import { isSoloExecutionTeam } from "../tree/parse.ts"
import type { TreeManifest } from "../tree/types.ts"

export const EXECUTION_TREE_IDLE_THRESHOLD_MS = 10_000
export const EXECUTION_TREE_WATCHDOG_POLL_MS = 2_000
export const EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS = 30_000

export async function loadWatchdogRootWakePrompt(
  projectDirectory: string,
  missionId: string,
  idleSeconds: number,
  manifest?: TreeManifest,
) {
  const solo = manifest ? isSoloExecutionTeam(manifest) : false
  const locale = readLocaleSync(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(watchdogRootWakePromptPath(projectDirectory, solo)).text(),
    readAgentNamesSync(projectDirectory),
  )
  let teamExecutionSnapshot = ""
  let nonRootNodeIds = ""
  if (!solo && manifest) {
    teamExecutionSnapshot = [
      gatehouseMessage("dispatch.teamSnapshot.watchdogSnapshotHeader", locale),
      "",
      formatExecutionTeamSnapshotFromManifest(manifest, locale),
    ].join("\n")
    nonRootNodeIds = [
      gatehouseMessage("dispatch.teamSnapshot.watchdogSnapshotNodesHeader", locale),
      "",
      formatNonRootNodeIdList(manifest, locale),
    ].join("\n")
  }
  return template
    .replaceAll("{{mission_id}}", missionId)
    .replaceAll("{{idle_seconds}}", String(idleSeconds))
    .replaceAll("{{team_execution_snapshot}}", teamExecutionSnapshot)
    .replaceAll("{{non_root_node_ids}}", nonRootNodeIds)
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
