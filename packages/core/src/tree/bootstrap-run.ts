import type { PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { nodeDisplayLabel, teamSpecPath } from "../paths.ts"
import { topologicalNodeOrder, validateTeamSpec, resolveInnerProfile } from "./parse.ts"
import { readManifest, upsertTreesIndex, writeManifest } from "./store.ts"
import type { TeamSpec, TreeManifest } from "./types.ts"
import { loadGatehouseConfig, modelForInnerProfile } from "../gatehouse-config.ts"
import { createSession, promptSession } from "../session/client.ts"
import { skillDomainContextNote, listSkillSlugsInDomain } from "../retro/skill-kickoff.ts"
import { readAgentNamesSync } from "../names.ts"
import { readLocaleSync } from "../locale.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { assertMissionRunning } from "../missions/parse.ts"
import { scheduleOfficeLayoutSync } from "../portal/office-layout-schedule.ts"

export type BootstrapRunResult = {
  mission_id: string
  root_node: string
  root_session_id: string
  node_count: number
  manifest_path: string
  root_kickoff: Awaited<ReturnType<import("../registry/store.ts").RegistryStore["kickoffRootSession"]>>
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
  const createdAt = new Date().toISOString()
  const nodes: TreeManifest["nodes"] = {}
  const sessionByNode = new Map<string, string>()
  const models = loadGatehouseConfig(input.directory).models

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
    const agentNames = readAgentNamesSync(input.directory)
    const locale = readLocaleSync(input.directory)
    const skillSlugs = specNode.skill_domain
      ? await listSkillSlugsInDomain(input.directory, specNode.skill_domain)
      : []
    const system = specNode.skill_domain
      ? `${specNode.constraints.trim()}\n\n${skillDomainContextNote(specNode.skill_domain, agentNames, locale, skillSlugs)}`
      : specNode.constraints.trim()
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
  const contract = readActiveMissionContract(input.directory, spec.mission_id)
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
  const rootKickoff = await registry.kickoffRootSession(manifest, { objective })
  await registry.flushPendingDeliveries()

  scheduleOfficeLayoutSync(input.directory)

  return {
    mission_id: spec.mission_id,
    root_node: spec.root,
    root_session_id: nodes[spec.root]?.session_id ?? "",
    node_count: Object.keys(nodes).length,
    manifest_path: teamSpecPath(input.directory, spec.mission_id).replace("teamspec.yaml", "manifest.yaml"),
    root_kickoff: rootKickoff,
  } satisfies BootstrapRunResult
}
