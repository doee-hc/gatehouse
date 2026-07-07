import { planChildNodeIds, planLeafNodeIds } from "../plan/graph.ts"
import type { OrchestrationPlan } from "../plan/types.ts"
import type { MissionTeamSpec } from "../../missions/manifest/types.ts"
import { orchestrationRun, type OrchestrationRunConfig } from "../engine/run.ts"
import { orchestrationParallel, orchestrationPipeline } from "../engine/primitives.ts"
import type { MissionContext, OrchestrationEngine } from "../types.ts"

export function buildMissionContext(input: {
  objective: string
  team: MissionTeamSpec
  engine: OrchestrationEngine
  runConfig: OrchestrationRunConfig
  resolvePlan: () => Pick<OrchestrationPlan, "steps">
  readMissionContext: MissionContext["readMissionContext"]
  readContract: MissionContext["readContract"]
}): MissionContext {
  const { objective, team, engine, runConfig, resolvePlan, readMissionContext, readContract } = input
  return {
    objective,
    async run(nodeId, opts) {
      return orchestrationRun(engine, nodeId, opts, runConfig)
    },
    async parallel(tracks) {
      return orchestrationParallel(tracks)
    },
    async pipeline(items, firstStage, ...restStages) {
      return orchestrationPipeline(items, firstStage, ...restStages)
    },
    readMissionContext,
    readContract,
    nodeIds() {
      return Object.keys(team.nodes)
    },
    leaves() {
      const plan = resolvePlan()
      return planLeafNodeIds(team, plan)
    },
    children(nodeId) {
      return planChildNodeIds(resolvePlan(), nodeId)
    },
  }
}

export async function runOrchestrateSource(orchestrateSource: string, ctx: MissionContext) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (ctx: MissionContext) => Promise<void>
  const orchestrate = new AsyncFunction("ctx", orchestrateSource)
  await orchestrate(ctx)
}
