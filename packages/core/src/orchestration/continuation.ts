import type { PluginInput } from "@opencode-ai/plugin"
import type { RegistryStore } from "../registry/store.ts"
import { readMissionManifest } from "../missions/manifest/store.ts"
import { loadMissionScript } from "./script-load.ts"
import {
  applyBaselineToState,
  captureOrchestrationBaseline,
  resetOrchestrationForContinuation,
} from "./baseline.ts"
import { notifyArchitectOrchestrationFailure } from "./notify.ts"
import { saveOrchestrationBaselineRecord, saveOrchestrationPlanRecord } from "./plan-store.ts"
import {
  assertOrchestrationPlanVersion,
  assertOrchestrationScriptHash,
  orchestrationAllDone,
  readOrchestrationState,
  writeOrchestrationState,
} from "./state.ts"
import { startSandboxOrchestration, isSandboxRunning } from "./sandbox-runtime.ts"
import {
  orchestrationScriptUnchanged,
} from "./guards.ts"
import { readDeliveryDocument } from "../delivery/store.ts"
import { deliveryRevisionPromptPath } from "../paths.ts"
import { readAgentNamesSync, renderGatehouseTemplate } from "../names.ts"
import { OUTER_ARCHITECT_ID } from "../registry/types.ts"

export type ContinueOrchestrationResult =
  | { status: "continued"; mission_id: string; baseline_id: string; plan_version: string }
  | { status: "error"; message: string }
  | { status: "not_continuable"; reason: string }

export async function continueOrchestrationWithNewScript(
  input: PluginInput,
  store: RegistryStore,
  missionId: string,
  opts?: { deliveryVersion?: number; parentMissionId?: string },
): Promise<ContinueOrchestrationResult> {
  const manifest = await readMissionManifest(input.directory, missionId)
  if (!manifest) {
    return { status: "not_continuable", reason: "mission orchestration not started" }
  }

  const script = await loadMissionScript(input.directory, missionId)
  if (!script?.plan) {
    return { status: "error", message: "mission.script.ts failed plan compilation" }
  }

  const state = readOrchestrationState(input.directory, missionId)
  if (!state) {
    return { status: "not_continuable", reason: "orchestration state missing" }
  }
  if (orchestrationAllDone(state)) {
    return { status: "not_continuable", reason: "orchestration already complete" }
  }

  if (isSandboxRunning(missionId)) {
    return {
      status: "not_continuable",
      reason: "orchestration sandbox is already running; wait for it to stop before mode=continue",
    }
  }
  if (orchestrationScriptUnchanged(state, script.scriptHash, script.plan.plan_version)) {
    return {
      status: "not_continuable",
      reason:
        "mission.script.ts unchanged since last orchestration run; use gatehouse_submit_orchestration (submit) to resume, or rewrite the script before mode=continue",
    }
  }

  const delivery = await readDeliveryDocument(input.directory, missionId)
  const baseline = captureOrchestrationBaseline({
    missionId,
    state,
    ...(opts?.parentMissionId && { parentMissionId: opts.parentMissionId }),
    ...(opts?.deliveryVersion !== undefined
      ? { deliveryVersion: opts.deliveryVersion }
      : delivery?.active?.version !== undefined && { deliveryVersion: delivery.active.version }),
  })

  const hashCheck = assertOrchestrationScriptHash(state, script.scriptHash, { allowNewPlan: true })
  if (!hashCheck.ok) {
    return { status: "error", message: hashCheck.message }
  }
  const planCheck = assertOrchestrationPlanVersion(state, script.plan.plan_version, { allowNewPlan: true })
  if (!planCheck.ok) {
    return { status: "error", message: planCheck.message }
  }

  saveOrchestrationBaselineRecord(input.directory, baseline)
  applyBaselineToState(state, baseline)
  resetOrchestrationForContinuation(state, baseline)
  state.continuation_of = opts?.parentMissionId ?? missionId
  state.sandbox = {
    status: "stopped",
    script_hash: script.scriptHash,
    plan_version: script.plan.plan_version,
  }
  writeOrchestrationState(input.directory, state)
  saveOrchestrationPlanRecord(input.directory, script.plan)

  const started = await startSandboxOrchestration({
    plugin: input,
    store,
    script,
    resume: true,
  })
  if (started.status === "error") {
    await notifyArchitectOrchestrationFailure(store, input.directory, {
      missionId,
      error: started.message,
      scriptHash: script.scriptHash,
    })
    return { status: "error", message: started.message }
  }
  if (started.status === "already_running") {
    return {
      status: "not_continuable",
      reason: "orchestration sandbox is already running",
    }
  }

  return {
    status: "continued",
    mission_id: missionId,
    baseline_id: baseline.baseline_id,
    plan_version: script.plan.plan_version,
  }
}

export async function kickoffArchitectDeliveryRevision(
  store: RegistryStore,
  projectDirectory: string,
  input: {
    missionId: string
    fromVersion: number
    revisionBody: string
  },
) {
  const architect = store.byProfile("architect", "outer")
  if (!architect) {
    return { delivery: "skipped" as const, error: "architect session not registered" }
  }
  const templatePath = deliveryRevisionPromptPath(projectDirectory)
  const template = renderGatehouseTemplate(
    await Bun.file(templatePath).text(),
    readAgentNamesSync(projectDirectory),
  )
  const content = template
    .replaceAll("{{mission_id}}", input.missionId)
    .replaceAll("{{from_version}}", String(input.fromVersion))
    .replaceAll("{{revision_body}}", input.revisionBody)
  const result = await store.deliverSystemMessage(architect, content, architect.profile)
  await store.flushPendingDeliveries()
  return { delivery: result.status, architect_id: OUTER_ARCHITECT_ID, ...(result.error && { error: result.error }) }
}
