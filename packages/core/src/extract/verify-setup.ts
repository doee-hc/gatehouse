import type { GatehouseClient } from "../session/client.ts"
import { createSession } from "../session/client.ts"
import type { ExtractManifest } from "../tree/types.ts"
import type { VerifyManifest } from "../tree/types.ts"
import { verifySessionTitle } from "../paths.ts"
import { INNER_VERIFY_AGENT } from "../registry/types.ts"

export async function createVerifyManifest(input: {
  client: GatehouseClient
  projectDirectory: string
  extract: ExtractManifest
}): Promise<VerifyManifest> {
  const nodes: VerifyManifest["nodes"] = {}
  for (const nodeId of input.extract.extract_order) {
    const extractNode = input.extract.nodes[nodeId]
    if (!extractNode) continue
    const verify_session_id = await createSession(input.client, input.projectDirectory, {
      display_name: verifySessionTitle(input.extract.mission_id, nodeId),
      profile: INNER_VERIFY_AGENT,
    })
    nodes[nodeId] = {
      extract_session_id: extractNode.extract_session_id,
      verify_session_id,
      skill_domain: extractNode.skill_domain,
    }
  }
  return {
    mission_id: input.extract.mission_id,
    created_at: new Date().toISOString(),
    nodes,
    verify_order: input.extract.extract_order,
  }
}
