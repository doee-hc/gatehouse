import { missionScriptRelPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import type { RegistryStore } from "../registry/store.ts"
import { readMissionScriptSource } from "./script-load.ts"
import { hashMissionScriptSource } from "./script-parse.ts"

export function architectOrchestrationFailureMessage(input: {
  missionId: string
  error: string
  scriptPath: string
  locale: ReturnType<typeof readLocaleSync>
}) {
  return gatehouseMessage("orchestration.failed", input.locale, {
    mission_id: input.missionId,
    error: input.error,
    script_path: input.scriptPath,
  })
}

export async function notifyArchitectOrchestrationFailure(
  registry: RegistryStore,
  projectDirectory: string,
  input: { missionId: string; error: string; scriptHash?: string },
) {
  const architect = registry.byProfile("architect", "outer")
  if (!architect) {
    return { delivery: "skipped" as const, error: "architect session not registered" }
  }

  if (input.scriptHash) {
    const source = await readMissionScriptSource(projectDirectory, input.missionId)
    if (source && hashMissionScriptSource(source) !== input.scriptHash) {
      return { delivery: "skipped" as const, reason: "script changed since failure" }
    }
  }

  const locale = readLocaleSync(projectDirectory)
  const content = architectOrchestrationFailureMessage({
    missionId: input.missionId,
    error: input.error,
    scriptPath: missionScriptRelPath(input.missionId),
    locale,
  })
  const result = await registry.deliverSystemMessage(architect, content, architect.profile)
  await registry.flushPendingDeliveries()
  return { delivery: result.status, ...(result.error && { error: result.error }) }
}
