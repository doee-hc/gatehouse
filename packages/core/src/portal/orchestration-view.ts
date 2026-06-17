import { RegistryDatabase } from "../registry/db.ts"
import { portalNodeDisplayName } from "../paths.ts"
import type { PortalTree } from "./snapshot.ts"
import type { PlanStepOp } from "../orchestration/plan-types.ts"
import type { OrchestrationNodeStatus } from "../orchestration/types.ts"

export type PortalOrchestrationNode = {
  node_id: string
  display_name: string
  parent: string | null
  skill_domain?: string
  status: OrchestrationNodeStatus
  round?: number
}

export type PortalOrchestrationPhase = {
  title: string
  state: "done" | "current" | "pending"
}

export type PortalOrchestrationStep = {
  id: string
  op: PlanStepOp
  state: "done" | "current" | "pending"
  title?: string
  node_id?: string
}

export type PortalOrchestration = {
  mission_id: string
  active: boolean
  phase?: string
  sandbox_status?: string
  cursor_step_index: number
  total_steps: number
  completed_steps: number
  phases: PortalOrchestrationPhase[]
  steps: PortalOrchestrationStep[]
  nodes: PortalOrchestrationNode[]
  root_node: string
}

function stepLabel(step: { op: PlanStepOp; node_id?: string }) {
  if (step.node_id) return `${step.op}:${step.node_id}`
  return step.op
}

function buildPhaseStrip(input: {
  declaredPhases: string[]
  planPhaseTitles: string[]
  currentPhase?: string
}): PortalOrchestrationPhase[] {
  const titles =
    input.declaredPhases.length > 0
      ? input.declaredPhases
      : input.planPhaseTitles.length > 0
        ? input.planPhaseTitles
        : input.currentPhase
          ? [input.currentPhase]
          : []

  if (titles.length === 0) return []

  const currentIndex = input.currentPhase ? titles.indexOf(input.currentPhase) : -1
  return titles.map((title, index) => ({
    title,
    state:
      currentIndex < 0
        ? ("pending" as const)
        : index < currentIndex
          ? ("done" as const)
          : index === currentIndex
            ? ("current" as const)
            : ("pending" as const),
  }))
}

export function buildPortalOrchestration(
  projectDirectory: string,
  tree: PortalTree | undefined,
): PortalOrchestration | undefined {
  if (!tree) return undefined

  const db = new RegistryDatabase(projectDirectory, { readonly: true })
  const orchState = db.getOrchestrationState(tree.mission_id)
  const plan = db.getLatestOrchestrationPlan(tree.mission_id)
  const script = db.getMissionScript(tree.mission_id)

  const nodeStatus = new Map<string, OrchestrationNodeStatus>()
  if (orchState) {
    for (const [nodeId, node] of Object.entries(orchState.nodes)) {
      nodeStatus.set(nodeId, node.status)
    }
  }

  const nodes: PortalOrchestrationNode[] = tree.nodes.map((node) => {
    const status = nodeStatus.get(node.node_id) ?? ("pending" as const)
    const round = orchState?.nodes[node.node_id]?.round
    return {
      node_id: node.node_id,
      display_name: portalNodeDisplayName(node.node_id, node.display_name),
      parent: node.parent,
      ...(node.skill_domain && { skill_domain: node.skill_domain }),
      status,
      ...(round !== undefined && { round }),
    }
  })

  const planPhaseTitles: string[] = []
  const declaredPhases = script?.meta?.phases ?? []
  const phases = buildPhaseStrip({
    declaredPhases,
    planPhaseTitles,
    ...(orchState?.phase && { currentPhase: orchState.phase }),
  })

  const cursorIndex = orchState?.cursor_step_index ?? 0
  const planSteps = plan?.steps ?? []
  const steps: PortalOrchestrationStep[] = planSteps.map((step, index) => {
    const done = index < cursorIndex
    const current = !done && index === cursorIndex
    return {
      id: step.id,
      op: step.op,
      state: done ? ("done" as const) : current ? ("current" as const) : ("pending" as const),
      ...(step.nodeId && { node_id: step.nodeId }),
    }
  })

  const missionRunning = tree.status === "running"
  const hasRuntime = Boolean(script || orchState || plan)

  return {
    mission_id: tree.mission_id,
    active: missionRunning && hasRuntime,
    ...(orchState?.phase && { phase: orchState.phase }),
    ...(orchState?.sandbox?.status && { sandbox_status: orchState.sandbox.status }),
    cursor_step_index: cursorIndex,
    total_steps: planSteps.length,
    completed_steps: cursorIndex,
    phases,
    steps,
    nodes,
    root_node: tree.root_node,
  }
}

export function orchestrationStepSummary(step: PortalOrchestrationStep) {
  return stepLabel(step)
}
