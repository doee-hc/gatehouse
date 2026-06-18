import { orchestrationParallel } from "./primitives.ts"
import type { NodeBriefPartial, OrchestrationEngine, RunOpts } from "./types.ts"

export type OrchestrationRunConfig = {
  /** Used when run omits text or passes empty text (defaults to ctx.template.workOrder). */
  defaultWorkOrder?: (nodeId: string) => string
}

function resolveBrief(opts: RunOpts | undefined, nodeId: string): NodeBriefPartial | undefined {
  if (!opts?.brief) return undefined
  return typeof opts.brief === "function" ? opts.brief(nodeId) : opts.brief
}

function resolveText(opts: RunOpts | undefined, nodeId: string): string | undefined {
  if (opts?.text === undefined) return undefined
  return typeof opts.text === "function" ? opts.text(nodeId) : opts.text
}

function resolvePromptText(
  opts: RunOpts | undefined,
  nodeId: string,
  reply: boolean,
  runConfig?: OrchestrationRunConfig,
): string | undefined {
  let text = resolveText(opts, nodeId)
  if (reply && (!text || !text.trim()) && runConfig?.defaultWorkOrder) {
    text = runConfig.defaultWorkOrder(nodeId)
  }
  return text
}

/** Activate one node: optional dependsOn barrier, then dispatch and wait for completion. */
export async function orchestrationRun(
  engine: OrchestrationEngine,
  nodeId: string,
  opts?: RunOpts,
  runConfig?: OrchestrationRunConfig,
): Promise<void> {
  if (!nodeId) throw new Error("run requires a node id")

  const reply = opts?.reply !== false
  const brief = resolveBrief(opts, nodeId)
  if (brief) await engine.setBrief(nodeId, brief)

  const text = resolvePromptText(opts, nodeId, reply, runConfig)
  await engine.prompt(nodeId, {
    ...(text !== undefined && { text }),
    reply,
    ...(opts?.dependsOn && { dependsOn: opts.dependsOn }),
  })

  if (reply) {
    await engine.waitFor(nodeId, "complete")
  }
}

/** Run independent orchestration tracks concurrently; barrier waits for all tracks. */
export async function orchestrationFork<T>(
  tracks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (tracks.length === 0) return []
  return orchestrationParallel(tracks)
}
