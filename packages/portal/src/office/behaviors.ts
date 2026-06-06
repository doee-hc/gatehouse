import type { AgentStatus } from "./dom-labels.ts"

export type BehaviorKind =
  | "stand"
  | "sit"
  | "typing"
  | "run"
  | "slacking"
  | "cat"
  | "research"

export type IdleBehaviorContext = {
  nearCat?: boolean
  atWorkspaceAnchor?: boolean
  atChair?: boolean
  seated?: boolean
  /** Stable 0..1 roll for slacking / play_cat; defaults to hash(agentId). */
  random?: number
}

export type AgentBehaviorInput = {
  status: AgentStatus
  isMoving: boolean
  agentId?: string
  idleContext?: IdleBehaviorContext
}

/** Maps portal agent status + movement to a sprite behavior (Phaser anim suffix). */
export function behaviorForAgent(input: AgentBehaviorInput): BehaviorKind {
  if (input.idleContext?.seated) return "sit"
  if (input.isMoving) return "run"
  if (input.status === "research") return "research"
  if (input.status === "blocked") return "slacking"
  if (input.status === "busy") {
    if (input.idleContext?.atChair) return "sit"
    if (input.idleContext?.atWorkspaceAnchor) return "typing"
    return "typing"
  }
  if (input.agentId) return idleBehaviorKind(input.agentId, input.idleContext ?? {})
  return "stand"
}

/** Idle variety: play with cat when nearby, otherwise slacking / sit / stand from stable hash. */
export function idleBehaviorKind(agentId: string, context: IdleBehaviorContext = {}): BehaviorKind {
  const roll = context.random ?? agentIdleRandom(agentId)
  if (context.nearCat && roll < 0.75) return "cat"
  if (roll < 0.15) return "slacking"
  if (context.atChair) return "sit"
  if (roll < 0.4) return "sit"
  return "stand"
}

export function agentIdleRandom(agentId: string) {
  return hashAgentId(agentId) / 0xffffffff
}

function hashAgentId(agentId: string) {
  let hash = 0
  for (const char of agentId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}
