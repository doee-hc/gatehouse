import { bulletList } from "../missions/parse.ts"
import { requireActiveMissionContract } from "../missions/contract.ts"
import { dispatchRootPromptPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import type { RegistryStore } from "../registry/store.ts"
import { isSoloExecutionTeam } from "../tree/parse.ts"
import type { TreeManifest } from "../tree/types.ts"
import {
  buildDispatchRootTeamSnapshot,
  formatExecutionTeamSnapshotFromManifest,
} from "./team-snapshot.ts"

export async function loadDispatchRootPrompt(
  projectDirectory: string,
  missionId: string,
  input?: {
    objective?: string
    manifest?: TreeManifest
    teamExecutionSnapshot?: string
    store?: RegistryStore
    rootSessionId?: string
    rootProfile?: string
  },
) {
  const contract = requireActiveMissionContract(projectDirectory, missionId)
  const solo = input?.manifest ? isSoloExecutionTeam(input.manifest) : false
  const template = renderGatehouseTemplate(
    await Bun.file(dispatchRootPromptPath(projectDirectory, solo)).text(),
    readAgentNamesSync(projectDirectory),
  )
  const locale = readLocaleSync(projectDirectory)
  const objective =
    input?.objective ??
    contract.objective ??
    gatehouseMessage("mission.objectiveMissing", locale)
  let teamExecutionSnapshot = ""
  if (!solo && input?.manifest) {
    if (input.teamExecutionSnapshot !== undefined) {
      teamExecutionSnapshot = input.teamExecutionSnapshot
    } else if (input.store && input.rootSessionId && input.rootProfile) {
      teamExecutionSnapshot = await buildDispatchRootTeamSnapshot({
        store: input.store,
        directory: projectDirectory,
        manifest: input.manifest,
        rootSessionId: input.rootSessionId,
        rootProfile: input.rootProfile,
      })
    } else {
      teamExecutionSnapshot = formatExecutionTeamSnapshotFromManifest(input.manifest, locale)
    }
  }
  return template
    .replaceAll("{{mission_id}}", missionId)
    .replaceAll("{{objective}}", objective)
    .replaceAll("{{done_when_list}}", bulletList(contract.done_when, locale))
    .replaceAll("{{must_not_list}}", bulletList(contract.must_not, locale))
    .replaceAll("{{team_execution_snapshot}}", teamExecutionSnapshot)
}
