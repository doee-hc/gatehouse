import type { PluginInput } from "@opencode-ai/plugin"
import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryStore } from "../registry/store.ts"
import { readLocaleSync } from "../locale.ts"
import { readActiveMissionContract, registryMissionToContract } from "../missions/contract.ts"
import { formatMissionContextBlock } from "../execution/context.ts"
import { runAcceptanceSlicePrecheck } from "../execution/acceptance-precheck.ts"
import { sanitizeInnerBriefStrings } from "../missions/done-when-filter.ts"
import type { NodeBrief } from "../execution/types.ts"
import type { NodeCompletion } from "./types.ts"
import { deliverOrchestrationPrompt } from "./prompt.ts"
import { readOrchestrationState, writeOrchestrationState } from "./state.ts"
import { validateReworkRequest } from "./rework.ts"
import { formatReworkResumeText, formatReworkText } from "./templates.ts"
import { notifyOrchestrationWaiters } from "./wait.ts"

function mergeBrief(existing: NodeBrief | undefined, nodeId: string, partial: Partial<NodeBrief>): NodeBrief {
  const your_work = sanitizeInnerBriefStrings(partial.your_work ?? existing?.your_work ?? [])
  const acceptance_slice = sanitizeInnerBriefStrings(
    partial.acceptance_slice ?? existing?.acceptance_slice ?? [],
  )
  return {
    node_id: nodeId,
    your_work,
    not_your_job: partial.not_your_job ?? existing?.not_your_job ?? [],
    acceptance_slice,
    ...(partial.role ?? existing?.role ? { role: partial.role ?? existing?.role } : {}),
  }
}

export async function orchestrationComplete(input: {
  plugin: PluginInput
  store: RegistryStore
  missionId: string
  nodeId: string
  completion?: NodeCompletion
  skipAcceptanceSlice?: boolean
}) {
  const scriptRecord = new RegistryDatabase(input.plugin.directory, { readonly: true }).getMissionScript(
    input.missionId,
  )
  if (!scriptRecord) return { status: "no_orchestration" as const }

  const state = readOrchestrationState(input.plugin.directory, input.missionId)
  if (!state) return { status: "no_state" as const }

  const node = state.nodes[input.nodeId]
  if (!node) return { status: "unknown_node" as const, node_id: input.nodeId }
  if (node.status !== "running" && node.status !== "rework") {
    return { status: "not_active" as const, current: node.status }
  }

  const registry = new RegistryDatabase(input.plugin.directory, { readonly: true })
  const brief = registry.getNodeBrief(input.missionId, input.nodeId)
  if (brief?.acceptance_slice.length && !input.skipAcceptanceSlice) {
    const acceptanceCheck = await runAcceptanceSlicePrecheck(
      input.plugin.directory,
      brief.acceptance_slice,
    )
    if (!acceptanceCheck.ok) {
      return {
        status: "acceptance_precheck_failed" as const,
        node_id: input.nodeId,
        message: acceptanceCheck.message,
        precheck: acceptanceCheck.precheck,
      }
    }
  }

  const now = new Date().toISOString()
  state.nodes[input.nodeId] = {
    ...node,
    status: "done",
    completed_at: now,
    blocked_by: undefined,
    rework_reason: undefined,
    ...(input.completion && { completion: input.completion }),
  }

  const unblocked: string[] = []
  for (const [id, entry] of Object.entries(state.nodes)) {
    if (entry.status === "blocked" && entry.blocked_by === input.nodeId) {
      state.nodes[id] = {
        ...entry,
        status: "running",
        activated_at: now,
      }
      unblocked.push(id)
    }
  }

  writeOrchestrationState(input.plugin.directory, state)
  notifyOrchestrationWaiters(input.missionId, state)

  for (const nodeId of unblocked) {
    const entry = state.nodes[nodeId]
    const text = formatReworkResumeText(input.plugin.directory, {
      missionId: input.missionId,
      nodeId,
      blocker: input.nodeId,
      ...(entry?.rework_reason && { reason: entry.rework_reason }),
    })
    await deliverOrchestrationPrompt({
      plugin: input.plugin,
      store: input.store,
      missionId: input.missionId,
      nodeId,
      prompt: { text, reply: true },
    })
  }

  return {
    status: "ok" as const,
    node_id: input.nodeId,
    unblocked,
    all_done: Object.values(state.nodes).every((n) => n.status === "done"),
    ...(input.completion && { completion: input.completion }),
  }
}

export async function orchestrationRework(input: {
  plugin: PluginInput
  store: RegistryStore
  missionId: string
  requesterNodeId: string
  blockedByNodeId: string
  reason: string
  evidencePath?: string
}) {
  const registry = new RegistryDatabase(input.plugin.directory, { readonly: true })
  const scriptRecord = registry.getMissionScript(input.missionId)
  if (!scriptRecord) return { status: "no_orchestration" as const }

  const state = readOrchestrationState(input.plugin.directory, input.missionId)
  if (!state) return { status: "no_state" as const }

  const validation = validateReworkRequest({
    team: scriptRecord.team,
    meta: scriptRecord.meta,
    state,
    requesterNodeId: input.requesterNodeId,
    blockedByNodeId: input.blockedByNodeId,
  })
  if (!validation.ok) {
    if (validation.code === "UNKNOWN_BLOCKER" || validation.code === "UNKNOWN_REQUESTER") {
      return { status: validation.code, node_id: validation.node_id }
    }
    if (validation.code === "NOT_RUNNING") {
      return { status: "not_active" as const, current: validation.current }
    }
    return { status: "forbidden" as const, reason: validation.reason ?? validation.code }
  }

  state.nodes[input.blockedByNodeId] = {
    ...state.nodes[input.blockedByNodeId],
    status: "rework",
    rework_reason: input.reason,
    blocked_by: input.requesterNodeId,
  }
  state.nodes[input.requesterNodeId] = {
    ...state.nodes[input.requesterNodeId],
    status: "blocked",
    blocked_by: input.blockedByNodeId,
    rework_reason: input.reason,
  }

  writeOrchestrationState(input.plugin.directory, state)

  const text = formatReworkText(input.plugin.directory, {
    missionId: input.missionId,
    nodeId: input.blockedByNodeId,
    requester: input.requesterNodeId,
    reason: input.reason,
    ...(input.evidencePath && { evidence: input.evidencePath }),
  })

  const delivery = await deliverOrchestrationPrompt({
    plugin: input.plugin,
    store: input.store,
    missionId: input.missionId,
    nodeId: input.blockedByNodeId,
    prompt: { text, reply: true },
  })

  return {
    status: "ok" as const,
    reopened: input.blockedByNodeId,
    blocked: input.requesterNodeId,
    delivery: delivery.status,
  }
}

export async function mergeAndSaveBrief(
  projectDirectory: string,
  missionId: string,
  nodeId: string,
  partial: {
    your_work?: string[]
    not_your_job?: string[]
    acceptance_slice?: string[]
    role?: string
  },
) {
  const registry = new RegistryDatabase(projectDirectory)
  const existing = registry.getNodeBrief(missionId, nodeId)
  const merged = mergeBrief(existing, nodeId, partial)
  registry.saveNodeBrief(missionId, nodeId, merged)
  return merged
}

export function readMissionContextForScript(projectDirectory: string, missionId: string) {
  const contract = readActiveMissionContract(projectDirectory, missionId)
  if (!contract) return ""
  const locale = readLocaleSync(projectDirectory)
  return formatMissionContextBlock(contract, locale)
}

export function readContractForScript(projectDirectory: string, missionId: string, view?: "summary" | "full") {
  const registry = new RegistryDatabase(projectDirectory, { readonly: true })
  const record = registry.getMission(missionId)
  if (!record) return undefined
  const contract = registryMissionToContract(record)
  if (view === "full") return contract
  return {
    mission_id: contract.mission_id,
    objective: contract.objective,
    must_not: contract.must_not,
  }
}
