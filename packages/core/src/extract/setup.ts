import type { GatehouseClient } from "../session/client.ts"
import { createSession } from "../session/client.ts"
import type { TeamSpec, TreeManifest } from "../tree/types.ts"
import type { ExtractManifest } from "../tree/types.ts"
import { execSkillKickoffTargets } from "../retro/skill-kickoff.ts"
import { extractSessionTitle } from "../paths.ts"
import { INNER_EXTRACT_AGENT } from "../registry/types.ts"

export async function createExtractManifest(input: {
  client: GatehouseClient
  projectDirectory: string
  manifest: TreeManifest
  spec?: TeamSpec
}): Promise<ExtractManifest> {
  const targets = execSkillKickoffTargets(input.manifest, { spec: input.spec })
  const nodes: ExtractManifest["nodes"] = {}
  for (const target of targets) {
    const execNode = input.manifest.nodes[target.nodeId]
    if (!execNode) continue
    const extract_session_id = await createSession(input.client, input.projectDirectory, {
      display_name: extractSessionTitle(input.manifest.mission_id, target.nodeId),
      profile: INNER_EXTRACT_AGENT,
    })
    nodes[target.nodeId] = {
      exec_session_id: execNode.session_id,
      extract_session_id,
      skill_domain: target.skillDomain,
    }
  }
  return {
    mission_id: input.manifest.mission_id,
    created_at: new Date().toISOString(),
    nodes,
    extract_order: targets.map((target) => target.nodeId),
  }
}
