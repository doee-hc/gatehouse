import type { PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { manifestExportPath, nodeDisplayLabel } from "../paths.ts"
import { topologicalNodeOrder, validateTeamSpec, resolveInnerProfile } from "./parse.ts"
import { readManifest, upsertTreesIndex, writeManifest } from "./store.ts"
import type { TeamSpec, TreeManifest } from "./types.ts"
import { loadGatehouseConfig, modelForInnerProfile } from "../gatehouse-config.ts"
import { createSession, promptSession } from "../session/client.ts"
import { readAgentNamesSync } from "../names.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { assertMissionRunning } from "../missions/parse.ts"
import { scheduleOfficeLayoutSync } from "../portal/office-layout-schedule.ts"
import { buildBootstrapSystemForNode } from "../execution/node-session.ts"
import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { loadMissionScript } from "../orchestration/script-load.ts"
import { prepareOrchestrationRuntime, startOrchestrationRuntime } from "../orchestration/runtime.ts"

export type BootstrapRunResult = {
  mission_id: string
  root_node: string
  root_session_id: string
  node_count: number
  manifest_path: string
  orchestration_runtime?: Awaited<ReturnType<typeof startOrchestrationRuntime>>
}

export async function runBootstrapTree(
  input: PluginInput,
  spec: TeamSpec,
  options?: { objective?: string },
) {
  const existing = await readManifest(input.directory, spec.mission_id)
  if (existing) throw new Error(`Mission ${spec.mission_id} already bootstrapped`)

  assertMissionRunning(await readMissionsDocument(input.directory), spec.mission_id)
  validateTeamSpec(spec)

  const script = await loadMissionScript(input.directory, spec.mission_id)
  if (!script) {
    throw new Error(`Mission ${spec.mission_id} requires mission.script.ts`)
  }

  const createdAt = new Date().toISOString()
  const nodes: TreeManifest["nodes"] = {}
  const sessionByNode = new Map<string, string>()
  const models = loadGatehouseConfig(input.directory).models
  const contract = readActiveMissionContract(input.directory, spec.mission_id)

  for (const nodeId of topologicalNodeOrder(spec)) {
    const specNode = spec.nodes[nodeId]
    if (!specNode) throw new Error(`TeamSpec missing node ${nodeId}`)
    if (specNode.parent && !sessionByNode.has(specNode.parent)) {
      throw new Error(`parent session missing for ${nodeId}`)
    }
    const profile = resolveInnerProfile(spec, nodeId)
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
      parent: specNode.parent,
      display_name,
      description: specNode.description.trim(),
      profile,
      ...(specNode.skill_domain && { skill_domain: specNode.skill_domain }),
    }
    const nodeBrief = await readNodeBriefRegistry(input.directory, spec.mission_id, nodeId)
    const system = await buildBootstrapSystemForNode({
      projectDirectory: input.directory,
      spec,
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

  const manifest: TreeManifest = {
    mission_id: spec.mission_id,
    status: "running",
    root_node: spec.root,
    created_at: createdAt,
    nodes,
  }
  await writeManifest(input.directory, manifest)
  const objective = options?.objective ?? contract?.objective
  await upsertTreesIndex(input.directory, {
    mission_id: spec.mission_id,
    root_session_id: nodes[spec.root]?.session_id ?? "",
    root_node: spec.root,
    status: "running",
    created_at: createdAt,
    ...(objective && { objective }),
  })
  const registry = await getRegistryStore(input)
  registry.syncInnerFromManifest(manifest)

  await prepareOrchestrationRuntime(input.directory, manifest, script)
  const orchestrationRuntime = await startOrchestrationRuntime(input, registry, manifest, script)
  await registry.flushPendingDeliveries()
  scheduleOfficeLayoutSync(input.directory)

  return {
    mission_id: spec.mission_id,
    root_node: spec.root,
    root_session_id: nodes[spec.root]?.session_id ?? "",
    node_count: Object.keys(nodes).length,
    manifest_path: manifestExportPath(input.directory, spec.mission_id),
    orchestration_runtime: orchestrationRuntime,
  }
}
