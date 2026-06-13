import { expect, test } from "bun:test"
import {
  deliverableBlogPostId,
  deliverablePathsFromCriteria,
  isCoordinationReportPath,
  isPublishPathAllowed,
  resolvePublishTarget,
} from "../src/delivery/publish-policy.ts"
import { explainPublishSkipped } from "../src/delivery/publish-artifacts.ts"
import type { DoneWhenCriterion } from "../src/delivery/types.ts"

const criteria: DoneWhenCriterion[] = [
  { id: 0, text: "api", check: { kind: "path_exists", path: "src/api.ts" } },
  {
    id: 1,
    text: "article",
    check: { kind: "path_exists", path: "content/post.md" },
  },
]

test("isCoordinationReportPath detects gatehouse reports", () => {
  expect(isCoordinationReportPath(".gatehouse/trees/m1/reports/root-delivery.md")).toBe(true)
  expect(isCoordinationReportPath(".gatehouse/skills/by-domain/d/x/SKILL.md")).toBe(false)
  expect(isCoordinationReportPath("content/post.md")).toBe(false)
})

test("deliverablePathsFromCriteria collects path_exists deliverables", () => {
  expect(deliverablePathsFromCriteria(criteria)).toEqual(["src/api.ts", "content/post.md"])
})

test("resolvePublishTarget blocks coordination reports", () => {
  const blocked = resolvePublishTarget({
    missionId: "m1",
    relPath: ".gatehouse/trees/m1/reports/root-delivery.md",
    criteria,
  })
  expect(blocked.kind).toBe("blocked")
})

test("resolvePublishTarget allows done_when deliverable paths", () => {
  const ok = resolvePublishTarget({
    missionId: "m1",
    relPath: "content/post.md",
    criteria,
  })
  expect(ok.kind).toBe("deliverable")
  if (ok.kind === "deliverable") {
    expect(ok.postId).toBe(deliverableBlogPostId("m1", "content/post.md"))
  }
})

test("resolvePublishTarget rejects paths not in deliverable list", () => {
  const blocked = resolvePublishTarget({
    missionId: "m1",
    relPath: "other/post.md",
    criteria,
  })
  expect(blocked.kind).toBe("blocked")
  if (blocked.kind === "blocked") {
    expect(blocked.reason).toContain("publish_deliverables=true")
  }
})

test("legacy publish shorthand in done_when becomes path_exists only", async () => {
  const { parseDoneWhenCriteriaFromRaw } = await import("../src/delivery/criteria.ts")
  const parsed = parseDoneWhenCriteriaFromRaw({
    done_when: [{ publish: "content/a.md" }],
  })
  expect(parsed[0]?.publishPath).toBeUndefined()
  expect(parsed[0]?.check).toEqual({ kind: "path_exists", path: "content/a.md" })
  expect(isPublishPathAllowed(parsed, "content/a.md")).toBe(true)
})

test("explainPublishSkipped reports missing deliverable paths", () => {
  const warnings = explainPublishSkipped({
    criteria: [{ id: 0, text: "path: reports/a.html", check: { kind: "manual" } }],
    precheck: [{ criterion_id: 0, status: "skipped", detail: "manual" }],
    forceSubmit: false,
    requestedPaths: [],
    published: [],
  })
  expect(warnings[0]).toContain("NO_DELIVERABLE_PATHS")
})
