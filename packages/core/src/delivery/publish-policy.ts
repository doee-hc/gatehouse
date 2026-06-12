import path from "node:path"
import type { DoneWhenCriterion } from "./types.ts"

export function normalizeProjectRelPath(relPath: string) {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** Gatehouse coordination reports — not Portal deliverables. */
export function isCoordinationReportPath(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  if (!rel.startsWith(".gatehouse/")) return false
  if (rel.startsWith(".gatehouse/skills/by-domain/")) return false
  return rel.includes("/reports/")
}

export function isSkillPublishPath(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  return /^\.gatehouse\/skills\/by-domain\/[^/]+\/[^/]+\/SKILL\.md$/.test(rel)
}

export function deliverableBlogPostId(missionId: string, relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  const slug = normalized
    .replace(/\.gatehouse\//g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${missionId}:deliverable:${slug || "file"}`
}

export function blogMissionIdFromDeliverablePostId(postId: string) {
  const prefix = ":deliverable:"
  const at = postId.indexOf(prefix)
  if (at <= 0) return undefined
  return postId.slice(0, at) || undefined
}

export function publishPathsFromCriteria(criteria: DoneWhenCriterion[]) {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const criterion of criteria) {
    if (!criterion.publishPath) continue
    const normalized = normalizeProjectRelPath(criterion.publishPath)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }
  return paths
}

export function criterionIdForPublishPath(criteria: DoneWhenCriterion[], relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  return criteria.find((item) => item.publishPath && normalizeProjectRelPath(item.publishPath) === normalized)?.id
}

export function isPublishPathAllowed(criteria: DoneWhenCriterion[], relPath: string) {
  const normalized = normalizeProjectRelPath(relPath)
  return criteria.some(
    (item) => item.publishPath && normalizeProjectRelPath(item.publishPath) === normalized,
  )
}

export function resolveSkillBlogPostId(relPath: string) {
  const rel = normalizeProjectRelPath(relPath)
  const skillMatch = rel.match(/^\.gatehouse\/skills\/by-domain\/([^/]+)\/([^/]+)\/SKILL\.md$/)
  if (!skillMatch?.[1] || !skillMatch[2]) return undefined
  return `skill:${skillMatch[1]}:${skillMatch[2]}`
}

export type PublishTarget =
  | { kind: "skill"; postId: string; path: string }
  | { kind: "deliverable"; postId: string; path: string; missionId: string }
  | { kind: "blocked"; path: string; reason: string }

export function resolvePublishTarget(input: {
  missionId: string
  relPath: string
  criteria: DoneWhenCriterion[]
}): PublishTarget {
  const pathNorm = normalizeProjectRelPath(input.relPath)
  if (isCoordinationReportPath(pathNorm)) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason: "Gatehouse coordination reports are not publishable; use project deliverable paths with done_when publish:",
    }
  }
  const skillId = resolveSkillBlogPostId(pathNorm)
  if (skillId) {
    return { kind: "skill", postId: skillId, path: pathNorm }
  }
  if (pathNorm.startsWith(".gatehouse/")) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason: "Only done_when publish: paths (project deliverables) or domain SKILL.md may be published",
    }
  }
  if (!isPublishPathAllowed(input.criteria, pathNorm)) {
    return {
      kind: "blocked",
      path: pathNorm,
      reason:
        `Path is not listed in done_when publish: for mission ${input.missionId}. ` +
        `The publish allowlist is frozen at gatehouse_mission_start (registry.db); ` +
        `editing missions.yaml after start cannot grant publish permission. ` +
        `Add publish: to done_when before start, or run a separate publish mission.`,
    }
  }
  return {
    kind: "deliverable",
    postId: deliverableBlogPostId(input.missionId, pathNorm),
    path: pathNorm,
    missionId: input.missionId,
  }
}

/** Paths marked publish: whose precheck is met (or force submit). */
export function deliverablesReadyToPublish(
  criteria: DoneWhenCriterion[],
  precheck: { criterion_id: number; status: string }[],
  forceSubmit: boolean,
) {
  const metIds = new Set(
    precheck.filter((item) => item.status === "met" || item.status === "partial").map((item) => item.criterion_id),
  )
  return publishPathsFromCriteria(criteria).filter((publishPath) => {
    const criterionId = criterionIdForPublishPath(criteria, publishPath)
    if (criterionId === undefined) return false
    if (forceSubmit) return true
    return metIds.has(criterionId)
  })
}

export function isUnderProjectRoot(projectDirectory: string, relPath: string) {
  const abs = path.resolve(projectDirectory, normalizeProjectRelPath(relPath))
  const root = path.resolve(projectDirectory)
  return abs === root || abs.startsWith(`${root}${path.sep}`)
}
