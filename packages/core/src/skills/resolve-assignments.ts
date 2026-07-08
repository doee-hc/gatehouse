import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import { acceptanceLayerNodeIds } from "../orchestration/plan/graph.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import type { SkillDomainEntry } from "./domains.ts"

export type SkillDomainAssignments = Record<string, string>

export type ResolvedSkillDomainAssignments = {
  assignments: SkillDomainAssignments
  source: "spec" | "user_skill" | "inferred"
}

function isAcceptanceLayerNode(plan: OrchestrationPlan, nodeId: string) {
  return acceptanceLayerNodeIds(plan).has(nodeId)
}

/** Leaf exec nodes that may receive skill_domain (coordination nodes omitted). */
export function nodesEligibleForSkillDomain(spec: MissionTeamSpec, plan: OrchestrationPlan) {
  return Object.keys(spec.nodes).filter((nodeId) => {
    if (nodeId === spec.terminal) return false
    if (isAcceptanceLayerNode(plan, nodeId)) return false
    return true
  })
}

export function assignmentsFromSpec(spec: MissionTeamSpec): SkillDomainAssignments {
  const out: SkillDomainAssignments = {}
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    if (node.skill_domain?.trim()) out[nodeId] = node.skill_domain.trim()
  }
  return out
}

export function parseUserSkillAssignments(userSkill: string | undefined): SkillDomainAssignments | undefined {
  if (!userSkill?.trim()) return undefined
  const trimmed = userSkill.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
    const out: SkillDomainAssignments = {}
    for (const [nodeId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) out[nodeId] = value.trim()
    }
    return Object.keys(out).length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

function scoreDomainMatch(description: string, domain: SkillDomainEntry) {
  const normalized = description.toLowerCase()
  const domainId = domain.id.toLowerCase()
  const domainText = `${domainId} ${(domain.label ?? "").toLowerCase()} ${(domain.description ?? "").toLowerCase()}`
  let score = 0

  for (const part of domain.id.split("-")) {
    if (part.length >= 4 && normalized.includes(part)) score += 1
  }

  const products = [
    "claude",
    "cursor",
    "copilot",
    "codex",
    "openclaw",
    "continue",
    "aider",
    "cody",
    "docs",
  ] as const
  for (const product of products) {
    if (!normalized.includes(product)) continue
    if (domainId.includes(product) || domainText.includes(product)) score += 3
  }

  return score
}

export function inferAssignmentsFromDomains(
  spec: MissionTeamSpec,
  plan: OrchestrationPlan,
  domains: SkillDomainEntry[],
) {
  if (domains.length === 0) return undefined

  const assignments: SkillDomainAssignments = { ...assignmentsFromSpec(spec) }
  for (const nodeId of nodesEligibleForSkillDomain(spec, plan)) {
    if (assignments[nodeId]) continue
    const description = spec.nodes[nodeId]?.description ?? ""
    let best: { id: string; score: number } | undefined
    let ambiguous = false
    for (const domain of domains) {
      const score = scoreDomainMatch(description, domain)
      if (score < 3) continue
      if (!best || score > best.score) {
        best = { id: domain.id, score }
        ambiguous = false
      } else if (best && score === best.score) {
        ambiguous = true
      }
    }
    if (best && !ambiguous) assignments[nodeId] = best.id
  }

  return assignments
}

export function skillAssignmentsReady(
  spec: MissionTeamSpec,
  plan: OrchestrationPlan,
  assignments: SkillDomainAssignments,
) {
  const eligible = nodesEligibleForSkillDomain(spec, plan)
  if (eligible.length === 0) return true
  return eligible.every((nodeId) => Boolean(assignments[nodeId]?.trim()))
}

export function resolveSkillDomainAssignments(
  spec: MissionTeamSpec,
  plan: OrchestrationPlan,
  input: { userSkill?: string; domains: SkillDomainEntry[] },
): ResolvedSkillDomainAssignments | undefined {
  let assignments = assignmentsFromSpec(spec)
  let source: ResolvedSkillDomainAssignments["source"] = "spec"

  const fromUser = parseUserSkillAssignments(input.userSkill)
  if (fromUser) {
    assignments = { ...assignments, ...fromUser }
    source = "user_skill"
  }

  if (!skillAssignmentsReady(spec, plan, assignments)) {
    const inferred = inferAssignmentsFromDomains(spec, plan, input.domains)
    if (!inferred || !skillAssignmentsReady(spec, plan, inferred)) return undefined
    assignments = inferred
    source = "inferred"
  }

  for (const nodeId of Object.keys(assignments)) {
    if (!spec.nodes[nodeId]) return undefined
  }

  const registeredIds = new Set(input.domains.map((domain) => domain.id))
  if (!Object.values(assignments).every((domainId) => registeredIds.has(domainId.trim()))) {
    return undefined
  }

  return { assignments, source }
}

export function applySkillDomainAssignments(spec: MissionTeamSpec, assignments: SkillDomainAssignments) {
  const next = structuredClone(spec)
  for (const [nodeId, domainId] of Object.entries(assignments)) {
    const node = next.nodes[nodeId]
    if (!node) throw new Error(`unknown node_id: ${nodeId}`)
    node.skill_domain = domainId
  }
  return next
}

export function nodesPendingSkillDomainAssignment(
  manifest: { nodes: Record<string, { skill_domain?: string }> },
  spec: MissionTeamSpec,
  plan: OrchestrationPlan,
) {
  const eligible = new Set(nodesEligibleForSkillDomain(spec, plan))
  return [...eligible].filter((nodeId) => !manifest.nodes[nodeId]?.skill_domain?.trim())
}
