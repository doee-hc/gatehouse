import type { PortalAgent } from "../api/types.ts"
import {
  formatPoolPrefix,
  INNER_POOL_PREFIXES,
  INNER_POOL_SIZE,
  OUTER_ROLE_IDS,
  type InnerPoolPrefix,
  type OuterRoleId,
} from "./character-manifest.ts"

export type { OuterRoleId, InnerPoolPrefix }

export type CharacterAtlasPrefix = OuterRoleId | InnerPoolPrefix

export { OUTER_ROLE_IDS, INNER_POOL_PREFIXES, INNER_POOL_SIZE }

export const OUTER_ATLAS_PREFIXES: OuterRoleId[] = [...OUTER_ROLE_IDS]

function isOuterRoleId(spawnId: string): spawnId is OuterRoleId {
  return (OUTER_ROLE_IDS as readonly string[]).includes(spawnId)
}

/** Inner-tree agents pick a stable pool sheet via hash(spawn_id | node_id). */
export function characterAtlasPrefix(agent: Pick<PortalAgent, "scope" | "spawn_id" | "node_id">) {
  if (agent.scope === "outer" && isOuterRoleId(agent.spawn_id)) return agent.spawn_id
  const seed = agent.scope === "retro" && agent.node_id ? agent.node_id : agent.spawn_id
  return formatPoolPrefix(pickInnerPoolIndex(seed) + 1)
}

function pickInnerPoolIndex(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return hash % INNER_POOL_SIZE
}
