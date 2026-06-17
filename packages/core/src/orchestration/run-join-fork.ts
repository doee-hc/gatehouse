import type { TeamSpec } from "../tree/types.ts"
import { childNodeIdsFromSpec } from "../tree/parse.ts"
import { orchestrationParallel } from "./primitives.ts"
import type { JoinOpts, NodeBriefPartial, OrchestrationEngine, RunOpts } from "./types.ts"

export type OrchestrationRunConfig = {
  /** Used when run omits text or passes empty text (defaults to ctx.template.workOrder). */
  defaultWorkOrder?: (nodeId: string) => string
}

function resolveIds(target: string | readonly string[]): string[] {
  return typeof target === "string" ? [target] : [...target]
}

function resolveBrief(opts: RunOpts | undefined, nodeId: string): NodeBriefPartial | undefined {
  if (!opts?.brief) return undefined
  return typeof opts.brief === "function" ? opts.brief(nodeId) : opts.brief
}

function resolveText(opts: RunOpts | undefined, nodeId: string): string | undefined {
  if (opts?.text === undefined) return undefined
  return typeof opts.text === "function" ? opts.text(nodeId) : opts.text
}

function defaultWait(target: string | readonly string[], opts: RunOpts | undefined): boolean {
  if (opts?.wait !== undefined) return opts.wait
  return true
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

/** Activate one or more nodes (fan-out dispatch). Optionally wait (fan-in) when wait !== false. */
export async function orchestrationRun(
  engine: OrchestrationEngine,
  target: string | readonly string[],
  opts?: RunOpts,
  runConfig?: OrchestrationRunConfig,
): Promise<void> {
  const ids = resolveIds(target)
  if (ids.length === 0) throw new Error("run requires at least one node id")

  const reply = opts?.reply !== false
  const wait = defaultWait(target, opts)

  for (const nodeId of ids) {
    const brief = resolveBrief(opts, nodeId)
    if (brief) await engine.setBrief(nodeId, brief)
  }

  for (const nodeId of ids) {
    const text = resolvePromptText(opts, nodeId, reply, runConfig)
    await engine.prompt(nodeId, {
      ...(text !== undefined && { text }),
      reply,
      ...(opts?.rollupFrom && ids.length === 1 && { rollupFrom: opts.rollupFrom }),
    })
  }

  if (wait) {
    await orchestrationJoin(engine, ids.length === 1 ? ids[0]! : ids)
  }
}

function collectDescendants(team: TeamSpec, rootNodeId: string) {
  const ids: string[] = []
  const walk = (nodeId: string) => {
    ids.push(nodeId)
    for (const child of childNodeIdsFromSpec(team, nodeId)) walk(child)
  }
  walk(rootNodeId)
  return ids
}

/** Wait for node completion; parallel wait for arrays; subtree waits all descendants. */
export async function orchestrationJoin(
  engine: OrchestrationEngine,
  target: string | readonly string[],
  opts?: JoinOpts,
  team?: TeamSpec,
): Promise<void> {
  if (opts?.subtree) {
    if (typeof target !== "string") {
      throw new Error("join(..., { subtree: true }) requires a single node id")
    }
    if (!team) throw new Error("join subtree requires team context")
    const descendants = collectDescendants(team, target).filter((id) => id !== target)
    for (const nodeId of descendants) {
      await engine.waitFor(nodeId, "complete", opts.timeout ? { timeout: opts.timeout } : undefined)
    }
    return
  }

  const ids = resolveIds(target)
  const waitOpts = opts?.timeout ? { timeout: opts.timeout } : undefined
  if (ids.length === 1) {
    await engine.waitFor(ids[0]!, "complete", waitOpts)
    return
  }
  await Promise.all(ids.map((nodeId) => engine.waitFor(nodeId, "complete", waitOpts)))
}

/** Run independent orchestration tracks concurrently; barrier waits for all tracks. */
export async function orchestrationFork<T>(
  tracks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (tracks.length === 0) return []
  return orchestrationParallel(tracks)
}
