import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import type { PlanStep, PlanStepOp } from "./types.ts"
import type { CompoundReplayState, MissionContext, OrchestrationState } from "../types.ts"
import type { SandboxRpcRequest } from "../sandbox/protocol.ts"
import { nodeAlreadyActivated } from "../state/store.ts"
import { orchestrationRun } from "../engine/run.ts"
import { orchestrationParallel } from "../engine/primitives.ts"
import type { OrchestrationEngine } from "../types.ts"

/** Steps with index < next_step_index are fully complete. */
export function replayNextStepIndex(state: OrchestrationState | undefined) {
  return state?.cursor_step_index ?? 0
}

export function isReplayStepComplete(state: OrchestrationState | undefined, stepIndex: number) {
  return stepIndex < replayNextStepIndex(state)
}

export function advanceReplayCursor(
  state: OrchestrationState,
  _stepId: string,
  stepIndex: number,
  _steps: readonly PlanStep[],
) {
  state.cursor_step_index = Math.max(replayNextStepIndex(state), stepIndex + 1)
  if (state.compound_replay?.step_id === _stepId) {
    delete state.compound_replay
  }
}

export function resetReplayCursor(state: OrchestrationState) {
  state.cursor_step_index = 0
  delete state.compound_replay
}

export type PlanStepKind = "linear" | "compound"

export function planStepKind(op: PlanStepOp | undefined): PlanStepKind {
  return op === "parallel" || op === "pipeline" ? "compound" : "linear"
}

function nodeIsDone(state: OrchestrationState, nodeId: string) {
  return state.nodes[nodeId]?.status === "done"
}

export function compoundReactivatedNodes(
  compound: CompoundReplayState | undefined,
  stepId: string | undefined,
): ReadonlySet<string> {
  if (!stepId || !compound || compound.step_id !== stepId) return new Set()
  return new Set(compound.reactivated)
}

export function armCompoundReactivation(state: OrchestrationState, stepId: string, nodeId: string) {
  const current = state.compound_replay
  const reactivated =
    current?.step_id === stepId ? new Set(current.reactivated) : new Set<string>()
  reactivated.add(nodeId)
  state.compound_replay = { step_id: stepId, reactivated: [...reactivated] }
}

export function consumeCompoundReactivation(state: OrchestrationState, stepId: string, nodeId: string) {
  const current = state.compound_replay
  if (!current || current.step_id !== stepId) return
  const reactivated = current.reactivated.filter((id) => id !== nodeId)
  if (reactivated.length === 0) delete state.compound_replay
  else state.compound_replay = { step_id: stepId, reactivated }
}

export type ReplayPromptDecision = "deliver" | "skip"

export function decideReplyPrompt(input: {
  state: OrchestrationState
  nodeId: string
  hasPlanStep: boolean
  stepIndex?: number
  stepKind: PlanStepKind
  reactivated: ReadonlySet<string>
}): ReplayPromptDecision {
  const { state, nodeId, hasPlanStep, stepIndex, stepKind, reactivated } = input

  if (!hasPlanStep) {
    return nodeAlreadyActivated(state, nodeId) ? "skip" : "deliver"
  }

  if (stepIndex !== undefined && isReplayStepComplete(state, stepIndex)) {
    return "skip"
  }

  if (stepKind === "compound" && nodeIsDone(state, nodeId) && !reactivated.has(nodeId)) {
    return "skip"
  }

  return "deliver"
}

export function shouldArmCompoundReactivation(input: {
  stepKind: PlanStepKind
  briefChanged: boolean
  state: OrchestrationState
  nodeId: string
}) {
  return input.stepKind === "compound" && input.briefChanged && nodeIsDone(input.state, input.nodeId)
}

type RpcSender = (request: Omit<SandboxRpcRequest, "type" | "id">) => Promise<unknown>

export type PlanStepScope = {
  step: PlanStep
  index: number
  run: () => Promise<void>
  complete: () => Promise<void>
}

function createPlanStepScope(input: {
  baseCtx: MissionContext
  step: PlanStep
  index: number
  sendRpc: RpcSender
  workOrderText: (nodeId: string, supplementary?: string) => string
}): PlanStepScope {
  const { baseCtx, step, index, sendRpc } = input

  const withStep = (request: Omit<SandboxRpcRequest, "type" | "id" | "stepId" | "stepIndex">) =>
    sendRpc({ ...request, stepId: step.id, stepIndex: index }) as Promise<void>

  const engine = {
    setBrief: (nodeId: string, partial: Parameters<OrchestrationEngine["setBrief"]>[1]) =>
      withStep({ op: "setBrief", nodeId, partial }),
    prompt: (nodeIds: string | string[], promptInput: Parameters<OrchestrationEngine["prompt"]>[1]) => {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds]
      return withStep({ op: "prompt", nodeIds: ids, input: promptInput })
    },
    waitFor: (nodeId: string, _event: "complete", opts?: { timeout?: string }) =>
      withStep({
        op: "waitFor",
        nodeId,
        event: "complete",
        ...(opts?.timeout && { timeout: opts.timeout }),
      }),
  } satisfies OrchestrationEngine

  const stepCtx: MissionContext = {
    ...baseCtx,
    async run(nodeId, opts) {
      await orchestrationRun(engine, nodeId, opts, { workOrderText: input.workOrderText })
    },
    async parallel(tracks) {
      return orchestrationParallel(tracks)
    },
  }

  return {
    step,
    index,
    async run() {
      const runner = compilePlanStepStatement(step.statement) as (ctx: MissionContext) => Promise<unknown>
      await runner(stepCtx)
    },
    async complete() {
      await withStep({ op: "stepComplete" })
    },
  }
}

/** Replay compiled plan steps from cursor; each step runs then explicitly completes. */
export async function replayPlanSteps(input: {
  baseCtx: MissionContext
  team: MissionTeamSpec
  steps: readonly PlanStep[]
  startIndex: number
  sendRpc: RpcSender
  workOrderText: (nodeId: string, supplementary?: string) => string
}) {
  for (let index = input.startIndex; index < input.steps.length; index += 1) {
    const step = input.steps[index]!
    const scope = createPlanStepScope({
      baseCtx: input.baseCtx,
      step,
      index,
      sendRpc: input.sendRpc,
      workOrderText: input.workOrderText,
    })
    await scope.run()
    await scope.complete()
  }
}

export function wrapPlanStepStatement(statement: string) {
  return `return (async () => { ${statement.trimEnd()}\n })()`
}

export function compilePlanStepStatement(statement: string) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (ctx: unknown) => Promise<unknown>
  return new AsyncFunction("ctx", wrapPlanStepStatement(statement))
}

export function validatePlanStepStatement(statement: string) {
  try {
    compilePlanStepStatement(statement)
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false as const, message }
  }
}
