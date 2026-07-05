import type { NodeBriefPartial, OrchestrationEngine, RunOpts, RunResult } from "./types.ts"

export type OrchestrationRunConfig = {
  /** Used when run omits text or passes empty text (defaults to ctx.template.workOrder). */
  defaultWorkOrder?: (nodeId: string) => string
}

export function runMissingBriefError(nodeId: string) {
  return new Error(
    `run requires brief for node "${nodeId}" (ctx.run(..., { brief: { your_work: [...], acceptance_slice: [...] }, ... }))`,
  )
}

function resolveBrief(opts: RunOpts, nodeId: string): NodeBriefPartial {
  return typeof opts.brief === "function" ? opts.brief(nodeId) : opts.brief
}

function resolveText(opts: RunOpts, nodeId: string): string | undefined {
  if (opts.text === undefined) return undefined
  return typeof opts.text === "function" ? opts.text(nodeId) : opts.text
}

function resolvePromptText(
  opts: RunOpts,
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

function mergeRunBrief(brief: NodeBriefPartial, opts: RunOpts): NodeBriefPartial {
  return {
    ...brief,
    ...(opts.completionSchema && { completion_schema: opts.completionSchema }),
  }
}

/** Activate one node: optional dependsOn barrier, then dispatch and wait for completion. */
export async function orchestrationRun(
  engine: OrchestrationEngine,
  nodeId: string,
  opts: RunOpts | undefined,
  runConfig?: OrchestrationRunConfig,
): Promise<RunResult | void> {
  if (!nodeId) throw new Error("run requires a node id")
  if (!opts?.brief) throw runMissingBriefError(nodeId)

  const reply = opts.reply !== false
  const brief = mergeRunBrief(resolveBrief(opts, nodeId), opts)
  await engine.setBrief(nodeId, brief)

  const text = resolvePromptText(opts, nodeId, reply, runConfig)
  await engine.prompt(nodeId, {
    ...(text !== undefined && { text }),
    reply,
    ...(opts.dependsOn && { dependsOn: opts.dependsOn }),
  })

  if (!reply) return

  const waitResult = await engine.waitFor(nodeId, "complete")
  if (!opts.returnStructured && !opts.completionSchema) return

  const completion = waitResult?.completion
  if (!completion) return
  return {
    ...(completion.structured_output !== undefined && { structured: completion.structured_output }),
    ...(completion.summary?.trim() && { summary: completion.summary.trim() }),
  }
}
