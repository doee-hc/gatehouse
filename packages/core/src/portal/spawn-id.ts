import type { RegistryAgent } from "../registry/types.ts"
import { normalizeOuterProfile } from "../names.ts"

/** Portal spawn ids for outer roles match profile slugs and OUTER_BOSS_SEATS agentId. */
export function spawnIdForAgent(agent: Pick<RegistryAgent, "scope" | "profile" | "nodeId" | "agentId">) {
  if (agent.scope === "outer") {
    const profile = normalizeOuterProfile(agent.profile)
    if (profile) return profile
  }
  if (agent.scope === "retro") {
    return "retro-analyst"
  }
  if (agent.scope === "extract" && agent.nodeId) {
    return `extract-${agent.nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  }
  if (agent.scope === "verify" && agent.nodeId) {
    return `verify-${agent.nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  }
  if (agent.nodeId) return agent.nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return agent.agentId.replace(/:/g, "-")
}
