import { expect, test } from "bun:test"
import {
  deliverableBlogPostId,
  isCoordinationReportPath,
  isPublishPathAllowed,
  publishPathsFromCriteria,
  resolvePublishTarget,
} from "../src/delivery/publish-policy.ts"
import type { DoneWhenCriterion } from "../src/delivery/types.ts"

const criteria: DoneWhenCriterion[] = [
  { id: 0, text: "api", check: { kind: "path_exists", path: "src/api.ts" } },
  {
    id: 1,
    text: "article",
    check: { kind: "path_exists", path: "content/post.md" },
    publishPath: "content/post.md",
  },
]

test("isCoordinationReportPath detects gatehouse reports", () => {
  expect(isCoordinationReportPath(".gatehouse/trees/m1/reports/root-delivery.md")).toBe(true)
  expect(isCoordinationReportPath(".gatehouse/skills/by-domain/d/x/SKILL.md")).toBe(false)
  expect(isCoordinationReportPath("content/post.md")).toBe(false)
})

test("publishPathsFromCriteria collects publish paths", () => {
  expect(publishPathsFromCriteria(criteria)).toEqual(["content/post.md"])
})

test("resolvePublishTarget blocks coordination reports", () => {
  const blocked = resolvePublishTarget({
    missionId: "m1",
    relPath: ".gatehouse/trees/m1/reports/root-delivery.md",
    criteria,
  })
  expect(blocked.kind).toBe("blocked")
})

test("resolvePublishTarget allows done_when publish paths", () => {
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

test("resolvePublishTarget rejects paths not in publish list", () => {
  const blocked = resolvePublishTarget({
    missionId: "m1",
    relPath: "src/api.ts",
    criteria,
  })
  expect(blocked.kind).toBe("blocked")
  if (blocked.kind === "blocked") {
    expect(blocked.reason).toContain("gatehouse_mission_start")
    expect(blocked.reason).toContain("frozen")
  }
})

test("parse publish shorthand from done_when", async () => {
  const { parseDoneWhenCriteriaFromRaw } = await import("../src/delivery/criteria.ts")
  const parsed = parseDoneWhenCriteriaFromRaw({
    done_when: [{ publish: "content/a.md" }],
  })
  expect(parsed[0]?.publishPath).toBe("content/a.md")
  expect(parsed[0]?.check).toEqual({ kind: "path_exists", path: "content/a.md" })
  expect(isPublishPathAllowed(parsed, "content/a.md")).toBe(true)
})
