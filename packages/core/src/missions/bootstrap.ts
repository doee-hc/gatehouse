import type { PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { INNER_EXECUTION_AGENT } from "../registry/types.ts"
import { manifestExportPath, nodeDisplayLabel } from "../paths.ts"
// missions/bootstrap.ts — do not confuse with missions/store.ts (missions.yaml queue)
import { validateMissionTeamSpec } from "./manifest/team-spec.ts"
import { readMissionManifest, writeMissionManifest } from "./manifest/store.ts"
import type { MissionTeamSpec, MissionManifest } from "./manifest/types.ts"
import { loadGatehouseConfig, modelForInnerProfile } from "../gatehouse-config.ts"
import { createSession, promptSession } from "../session/client.ts"
import { readAgentNamesSync } from "../names.ts"
import { readActiveMissionContract } from "./contract.ts"
import { readMissionsDocument } from "./store.ts"
import { assertMissionRunning } from "./parse.ts"
import { scheduleOfficeLayoutSync } from "../portal/office-layout-schedule.ts"
import { buildBootstrapSystemForNode } from "../execution/node-session.ts"
import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { loadMissionScript } from "../orchestration/script/load.ts"
import { resolveTerminalNode, teamNodeOrder } from "../orchestration/plan/graph.ts"
import { prepareOrchestrationRuntime, startOrchestrationRuntime } from "../orchestration/lifecycle/coordinator.ts"

export type MissionBootstrapResult = {
  mission_id: string
  terminal_node: string
  terminal_session_id: string
  node_count: number
  manifest_path: string
  orchestration_runtime?: Awaited<ReturnType<typeof startOrchestrationRuntime>>
}

export async function bootstrapMission(
  input: PluginInput,
  spec: MissionTeamSpec,
  options?: { objective?: string },
) {
  const existing = await readMissionManifest(input.directory, spec.mission_id)
  if (existing) throw new Error(`Mission ${spec.mission_id} already bootstrapped`)

  assertMissionRunning(await readMissionsDocument(input.directory), spec.mission_id)
  validateMissionTeamSpec(spec)

  const script = await loadMissionScript(input.directory, spec.mission_id)
  if (!script) {
    throw new Error(`Mission ${spec.mission_id} requires mission.script.ts`)
  }
  if (!script.plan) {
    throw new Error(`Mission ${spec.mission_id} requires a compiled orchestration plan`)
  }

  const createdAt = new Date().toISOString()
  const nodes: MissionManifest["nodes"] = {}
  const sessionByNode = new Map<string, string>()
  const models = loadGatehouseConfig(input.directory).models
  const contract = readActiveMissionContract(input.directory, spec.mission_id)

  for (const nodeId of teamNodeOrder(spec, script.plan)) {
    const specNode = spec.nodes[nodeId]
    if (!specNode) throw new Error(`MissionTeamSpec missing node ${nodeId}`)
    const profile = INNER_EXECUTION_AGENT
    const model = modelForInnerProfile(models, profile)
    const display_name = nodeDisplayLabel(nodeId)
    const sessionId = await createSession(input.client, input.directory, {
      display_name,
      profile,
      model,
    })
    sessionByNode.set(nodeId, sessionId)
    nodes[nodeId] = {
      session_id: sessionId,
      display_name,
      description: specNode.description.trim(),
      profile,
      ...(specNode.skill_domain && { skill_domain: specNode.skill_domain }),
    }
    const nodeBrief = await readNodeBriefRegistry(input.directory, spec.mission_id, nodeId)
    const system = await buildBootstrapSystemForNode({
      projectDirectory: input.directory,
      spec,
      plan: script.plan,
      nodeId,
      ...(contract && { contract }),
      agentNames: readAgentNamesSync(input.directory),
      ...(nodeBrief && { brief: nodeBrief }),
    })
    await promptSession(input.client, input.directory, sessionId, {
      profile,
      system,
      noReply: true,
      model,
    }, input)
  }

  const terminalNode = resolveTerminalNode({ plan: script.plan })
  if (!terminalNode || !nodes[terminalNode]) {
    throw new Error(
      `Mission ${spec.mission_id} orchestration plan has no terminal node matching team.nodes`,
    )
  }

  const manifest: MissionManifest = {
    mission_id: spec.mission_id,
    status: "running",
    terminal_node: terminalNode,
    created_at: createdAt,
    nodes,
  }
  await writeMissionManifest(input.directory, manifest)
  const registry = await getRegistryStore(input)
  registry.syncInnerFromManifest(manifest)

  const prepared = await prepareOrchestrationRuntime(input.directory, manifest, script)
  if (prepared.status === "error") {
    throw new Error(prepared.message)
  }
  const orchestrationRuntime = await startOrchestrationRuntime(input, registry, manifest, script)
  if (orchestrationRuntime.status === "error") {
    throw new Error(`Orchestration failed for ${spec.mission_id}: ${orchestrationRuntime.message}`)
  }
  await registry.flushPendingDeliveries()
  scheduleOfficeLayoutSync(input.directory)

  return {
    mission_id: spec.mission_id,
    terminal_node: terminalNode,
    terminal_session_id: nodes[terminalNode]?.session_id ?? "",
    node_count: Object.keys(nodes).length,
    manifest_path: manifestExportPath(input.directory, spec.mission_id),
    orchestration_runtime: orchestrationRuntime,
  }
}
