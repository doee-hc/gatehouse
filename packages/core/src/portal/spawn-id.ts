import type { RegistryAgent } from "../registry/types.ts"
import { normalizeOuterProfile } from "../names.ts"

/** Portal spawn ids for outer roles match profile slugs and OUTER_BOSS_SEATS agentId. */
export function spawnIdForAgent(agent: Pick<RegistryAgent, "scope" | "profile" | "nodeId" | "agentId">) {
  if (agent.scope === "outer") {
    const profile = normalizeOuterProfile(agent.profile)
    if (profile) return profile
  }
  if (agent.scope === "retro" && agent.nodeId) {
    return `retro-${agent.nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  }
  if (agent.nodeId) return agent.nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return agent.agentId.replace(/:/g, "-")
}
