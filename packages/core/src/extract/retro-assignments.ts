import type { GatehouseClient } from "../session/client.ts"
import { createSession } from "../session/client.ts"
import type { MissionManifest } from "../missions/manifest/types.ts"
import { readExtractManifest, writeExtractManifest } from "../missions/manifest/store.ts"
import { extractSessionTitle } from "../paths.ts"
import { INNER_EXTRACT_AGENT } from "../registry/types.ts"
import type { RegistryStore } from "../registry/store.ts"

export async function appendExtractNodesForAssignments(input: {
  client: GatehouseClient
  projectDirectory: string
  registry: RegistryStore
  manifest: MissionManifest
  assignments: Record<string, string>
}) {
  const { manifest, assignments } = input
  const missionId = manifest.mission_id
  let extract = await readExtractManifest(input.projectDirectory, missionId)
  const appendedNodeIds: string[] = []

  for (const [nodeId, domainValue] of Object.entries(assignments)) {
    const domainId = domainValue.trim()
    if (!domainId) continue
    if (extract?.nodes[nodeId]) continue
    const execNode = manifest.nodes[nodeId]
    if (!execNode?.skill_domain?.trim()) continue

    const extractSessionId = await createSession(input.client, input.projectDirectory, {
      display_name: extractSessionTitle(missionId, nodeId),
      profile: INNER_EXTRACT_AGENT,
    })
    const nodeEntry = {
      exec_session_id: execNode.session_id,
      extract_session_id: extractSessionId,
      skill_domain: domainId,
    }
    if (!extract) {
      extract = {
        mission_id: missionId,
        created_at: new Date().toISOString(),
        nodes: { [nodeId]: nodeEntry },
        extract_order: [nodeId],
      }
    } else {
      extract = {
        ...extract,
        nodes: { ...extract.nodes, [nodeId]: nodeEntry },
        extract_order: [...extract.extract_order, nodeId],
      }
    }
    appendedNodeIds.push(nodeId)
  }

  if (!extract || appendedNodeIds.length === 0) {
    return { appended: [] as string[], extract: extract ?? null }
  }

  await writeExtractManifest(input.projectDirectory, extract)
  input.registry.skillPipeline.syncExtractFromManifest(extract, manifest)
  input.registry.skillPipeline.appendSkillExtractRunNodes(missionId, appendedNodeIds)
  const deliveries = await input.registry.skillPipeline.kickoffExtractDeliveriesForNodes(extract, appendedNodeIds)
  await input.registry.flushPendingDeliveries()

  return { appended: appendedNodeIds, extract, deliveries }
}
