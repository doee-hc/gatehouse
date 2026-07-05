import type { MissionManifest, MissionMember, MissionTeamSpec, MissionMissionTeamSpecNode } from "./types.ts"

export function manifestMembers(manifest: MissionManifest): MissionMember[] {
  return Object.entries(manifest.nodes).map(([node_id, node]) => ({
    node_id,
    session_id: node.session_id,
    ...(node.display_name && { display_name: node.display_name }),
    ...(node.description && { description: node.description }),
    ...(node.profile && { profile: node.profile }),
  }))
}

export function validateMissionTeamSpec(spec: MissionTeamSpec) {
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    const raw = node as MissionMissionTeamSpecNode & { constraints?: unknown }
    if (raw.constraints !== undefined) {
      throw new Error(
        `MissionTeamSpec node ${nodeId} must not include constraints; use ctx.run({ brief: ... }) in mission.script.ts orchestrate()`,
      )
    }
    if (!node.description.trim()) throw new Error(`MissionTeamSpec node ${nodeId} requires a non-empty description`)
  }
  if (!spec.nodes[spec.terminal]) throw new Error("MissionTeamSpec terminal missing from nodes")
}
