import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import {
  criteriaFromMissionEntry,
  parseDoneWhenCriteriaFromRaw,
  runDeliveryPrecheck,
} from "../src/delivery/criteria.ts"
import {
  deliveryIsFinalized,
  finalizeDeliveryOnMissionComplete,
  readDeliveryDocument,
  reviewDeliveryRecord,
  submitDeliveryRecord,
} from "../src/delivery/store.ts"
import { missionCompleteTool } from "../src/tools/mission-complete.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { parseEvidenceInput } from "../src/delivery/evidence.ts"
import { deliveryReviewTool } from "../src/tools/delivery.ts"
import { executionCompleteTool } from "../src/tools/execution.ts"

let dir: string

function mockToolContext(directory: string, sessionID: string, agent = "build-root"): ToolContext {
  return {
    sessionID,
    messageID: "test-message",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      throw new Error("ask not implemented in mock")
    },
  }
}

function toolOutput(result: { output: string } | string) {
  return typeof result === "string" ? result : result.output
}

async function submitMissionDelivery(missionId: string, opts?: { summary?: string; forceReason?: string }) {
  const mission = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text())
    .missions[0]!
  return submitDeliveryRecord({
    projectDirectory: dir,
    missionId,
    submittedByNode: "root",
    summary: opts?.summary,
    forceReason: opts?.forceReason,
    missionEntry: mission,
  })
}

async function writeMissions(missionId: string, doneWhen: unknown[]) {
  await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
  await Bun.write(
    path.join(dir, ".gatehouse", "lead", "missions.yaml"),
    `schema_version: 2
missions:
  - id: ${missionId}
    status: running
    objective: "demo"
    done_when:
${doneWhen.map((item) => (typeof item === "string" ? `      - ${JSON.stringify(item)}` : `      - ${JSON.stringify(item)}`)).join("\n")}
    must_not: []
`,
  )
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-delivery-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("parseEvidenceInput accepts JSON string or array", () => {
  const evidence = [
    { criterion_id: 0, status: "met", proof: "ok" },
    { criterion_id: 1, status: "unmet" },
  ]
  expect(parseEvidenceInput(JSON.stringify(evidence))).toEqual([
    { criterion_id: 0, status: "met", proof: "ok" },
    { criterion_id: 1, status: "unmet" },
  ])
  expect(parseEvidenceInput(evidence)).toEqual([
    { criterion_id: 0, status: "met", proof: "ok" },
    { criterion_id: 1, status: "unmet" },
  ])
  expect(parseEvidenceInput(undefined)).toBeUndefined()
  expect(() => parseEvidenceInput({ criterion_id: 0 })).toThrow("evidence must be a JSON array")
})

test("parseDoneWhenCriteriaFromRaw supports structured done_when", () => {
  const criteria = parseDoneWhenCriteriaFromRaw({
    done_when: [
      "README updated",
      { path: "docs/foo.md" },
      {
        text: "tests pass",
        check: { kind: "command", cmd: "bun test", expect_exit: 0 },
      },
    ],
  })
  expect(criteria).toHaveLength(3)
  expect(criteria[1]?.check).toEqual({ kind: "path_exists", path: "docs/foo.md" })
  expect(criteria[2]?.check).toEqual({ kind: "command", cmd: "bun test", expect_exit: 0 })
})

test("parseDoneWhenCriteriaFromRaw supports path string prefixes", () => {
  const criteria = parseDoneWhenCriteriaFromRaw({
    done_when: [
      "path: reports/survey.html",
      "file exists: docs/readme.md",
      "文件存在: content/post.md",
    ],
  })
  expect(criteria.map((item) => item.check)).toEqual([
    { kind: "path_exists", path: "reports/survey.html" },
    { kind: "path_exists", path: "docs/readme.md" },
    { kind: "path_exists", path: "content/post.md" },
  ])
})

test("runDeliveryPrecheck checks path_exists", async () => {
  const rel = "docs/exists.md"
  await mkdir(path.join(dir, "docs"), { recursive: true })
  await Bun.write(path.join(dir, rel), "# ok")
  const mission = parseMissionsFile(`missions:
  - id: m1
    status: running
    done_when:
      - path: ${rel}
    must_not: []`).missions[0]!
  const criteria = criteriaFromMissionEntry(mission, [{ path: rel }])
  const precheck = await runDeliveryPrecheck(dir, criteria)
  expect(precheck[0]?.status).toBe("met")
})

test("submitDeliveryRecord blocks when precheck fails without force_reason", async () => {
  const missionId = "m-precheck"
  await writeMissions(missionId, [{ path: "missing.md" }])
  const mission = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text())
    .missions[0]!
  let message = ""
  try {
    await submitDeliveryRecord({
      projectDirectory: dir,
      missionId,
      submittedByNode: "root",
      missionEntry: mission,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("Precheck failed")
})

test("pendingMissionPublishPaths lists path_exists deliverables from done_when", async () => {
  const { pendingMissionPublishPaths } = await import("../src/delivery/publish-artifacts.ts")
  const rel = "docs/research/report.md"
  const criteria = parseDoneWhenCriteriaFromRaw({
    done_when: [{ path: rel }, "quality meets bar"],
  })
  expect(pendingMissionPublishPaths(criteria)).toEqual([rel])
})

test("submitDeliveryRecord exposes publishable paths via criteria without publishing", async () => {
  const missionId = "m-pub"
  const articleRel = "content/article.md"
  await writeMissions(missionId, [{ publish: articleRel }])
  await Bun.write(path.join(dir, articleRel), "# Article\n\nBody.")

  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync() {},
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: [],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await submitMissionDelivery(missionId, { summary: "done" })

  const { readBlogPublishedDocument } = await import("../src/portal/blog-publish.ts")
  const blog = await readBlogPublishedDocument(dir)
  expect(blog.posts).toHaveLength(0)

  const doc = await readDeliveryDocument(dir, missionId)
  const { pendingMissionPublishPaths } = await import("../src/delivery/publish-artifacts.ts")
  expect(doc?.active && pendingMissionPublishPaths(doc.active.criteria)).toEqual([articleRel])
  expect(doc?.active?.published_artifacts).toBeUndefined()
})

test("mission_complete done without publish_deliverables does not publish deliverables", async () => {
  const missionId = "m-pub-complete"
  const articleRel = "content/article.md"
  await writeMissions(missionId, [{ publish: articleRel }])
  await Bun.write(path.join(dir, articleRel), "# Article\n\nBody.")

  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync() {},
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: [],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const complete = missionCompleteTool(pluginInput)
  await submitMissionDelivery(missionId, { summary: "done" })

  const finalized = toolOutput(
    await complete.execute(
      { mission_id: missionId, status: "done", user_feedback: "looks good" },
      mockToolContext(dir, "ses_lead", "lead"),
    ),
  )
  expect(finalized).toContain("ok")

  const { readBlogPublishedDocument } = await import("../src/portal/blog-publish.ts")
  const blog = await readBlogPublishedDocument(dir)
  expect(blog.posts).toHaveLength(0)

  const doc = await readDeliveryDocument(dir, missionId)
  expect(doc?.active?.status).toBe("finalized")
  expect(doc?.active?.review?.decision).toBe("finalized")
  expect(doc?.active?.published_artifacts).toBeUndefined()
})

test("mission_complete done with publish_deliverables publishes done_when deliverable paths", async () => {
  const missionId = "m-pub-complete"
  const articleRel = "content/article.md"
  await writeMissions(missionId, [{ publish: articleRel }])
  await Bun.write(path.join(dir, articleRel), "# Article\n\nBody.")

  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync() {},
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: [],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const complete = missionCompleteTool(pluginInput)
  await submitMissionDelivery(missionId, { summary: "done" })

  const finalized = toolOutput(
    await complete.execute(
      {
        mission_id: missionId,
        status: "done",
        user_feedback: "looks good",
        publish_deliverables: true,
      },
      mockToolContext(dir, "ses_lead", "lead"),
    ),
  )
  expect(finalized).toContain("ok")
  expect(finalized).toContain(articleRel)

  const { readBlogPublishedDocument } = await import("../src/portal/blog-publish.ts")
  const blog = await readBlogPublishedDocument(dir)
  expect(blog.posts).toHaveLength(1)
  expect(blog.posts[0]?.path).toBe(articleRel)

  const doc = await readDeliveryDocument(dir, missionId)
  expect(doc?.active?.status).toBe("finalized")
  expect(doc?.active?.review?.decision).toBe("finalized")
  expect(doc?.active?.published_artifacts).toEqual([articleRel])
})

test("mission_complete publishes done_when path string prefix deliverables", async () => {
  const missionId = "m-path-string"
  const articleRel = "reports/survey.html"
  await writeMissions(missionId, [`path: ${articleRel}`])
  await Bun.write(path.join(dir, articleRel), "<html><title>Survey</title><body>ok</body></html>")

  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync() {},
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: [],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  const complete = missionCompleteTool(pluginInput)
  await submitMissionDelivery(missionId, { summary: "done" })

  const finalized = JSON.parse(
    toolOutput(
      await complete.execute(
        {
          mission_id: missionId,
          status: "done",
          publish_deliverables: true,
        },
        mockToolContext(dir, "ses_lead", "lead"),
      ),
    ),
  ) as { data?: { delivery?: { published_artifacts?: string[]; publish_warnings?: string[] } } }
  expect(finalized.data?.delivery?.published_artifacts).toEqual([articleRel])
  expect(finalized.data?.delivery?.publish_warnings ?? []).toEqual([])
})

test("mission_complete republishes deliverables added after delivery submit", async () => {
  const missionId = "m-late-file"
  const articleRel = "reports/late.html"
  await writeMissions(missionId, [{ path: articleRel }])

  const mission = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text())
    .missions[0]!
  const submitted = await submitDeliveryRecord({
    projectDirectory: dir,
    missionId,
    submittedByNode: "root",
    forceReason: "deliverable copied after submit",
    missionEntry: mission,
  })
  expect(submitted.record.precheck.find((item) => item.criterion_id === 0)?.status).toBe("unmet")

  await Bun.write(path.join(dir, articleRel), "<html><title>Late</title><body>ok</body></html>")

  const finalized = await finalizeDeliveryOnMissionComplete({
    projectDirectory: dir,
    missionId,
    missionEntry: mission,
    publishDeliverables: true,
  })
  expect(finalized.skipped).toBe(false)
  if (finalized.skipped) return
  expect(finalized.published_artifacts).toEqual([articleRel])
  expect(finalized.publish_warnings ?? []).toEqual([])
})

test("mission_complete returns publish_warnings when deliverable file still missing", async () => {
  const missionId = "m-missing-file"
  const articleRel = "reports/missing.html"
  await writeMissions(missionId, [`path: ${articleRel}`])

  const mission = parseMissionsFile(await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text())
    .missions[0]!
  await submitDeliveryRecord({
    projectDirectory: dir,
    missionId,
    submittedByNode: "root",
    forceReason: "manual acceptance",
    missionEntry: mission,
  })

  const finalized = await finalizeDeliveryOnMissionComplete({
    projectDirectory: dir,
    missionId,
    missionEntry: mission,
    publishDeliverables: true,
  })
  expect(finalized.skipped).toBe(false)
  if (finalized.skipped) return
  expect(finalized.published_artifacts).toEqual([])
  expect(finalized.publish_warnings?.some((item: string) => item.includes("PUBLISH_SKIPPED"))).toBe(true)
})

test("delivery submit + review revision flow", async () => {
  const missionId = "m-flow"
  await writeMissions(missionId, ["deliverable ready"])

  const promptCalls: string[] = []
  const pluginInput = {
    directory: dir,
    client: {
      session: {
        async promptAsync(input: unknown) {
          const record = input as {
            body: { parts: { text: string }[] }
          }
          promptCalls.push(record.body.parts[0]?.text ?? "")
        },
        async messages() {
          return { data: [] }
        },
        async get() {
          return { data: {} }
        },
        async status() {
          return { data: { ses_root: { type: "idle" }, ses_lead: { type: "idle" } } }
        },
      },
    },
  } as unknown as PluginInput

  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })
  store.register({
    agentId: `inner:${missionId}:root`,
    scope: "inner",
    profile: "build-root",
    sessionId: "ses_root",
    displayName: "root",
    missionId,
    nodeId: "root",
    status: "active",
  })
  store.activateMission({
    missionId,
    status: "running",
    doneWhen: ["deliverable ready"],
    mustNot: [],
    isActive: true,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await submitMissionDelivery(missionId, { summary: "all done" })

  const doc = await readDeliveryDocument(dir, missionId)
  expect(doc?.active?.version).toBe(1)
  expect(doc?.active?.status).toBe("submitted")

  const reviewed = await reviewDeliveryRecord({
    projectDirectory: dir,
    missionId,
    reviewedBy: "lead",
    decision: "revision_requested",
    failedCriteria: [0],
    revisionBrief: "Please add tests",
    userFeedback: "Please add tests",
  })
  expect(reviewed.revision).toBe(true)
  expect((await readDeliveryDocument(dir, missionId))?.active).toBeUndefined()

  await submitMissionDelivery(missionId, { summary: "fixed" })
  const second = await readDeliveryDocument(dir, missionId)
  expect(second?.active?.version).toBe(2)

  const missionEntry = parseMissionsFile(
    await Bun.file(path.join(dir, ".gatehouse", "lead", "missions.yaml")).text(),
  ).missions[0]!
  await finalizeDeliveryOnMissionComplete({
    projectDirectory: dir,
    missionId,
    missionEntry,
    userFeedback: "approved",
  })
  expect(deliveryIsFinalized(await readDeliveryDocument(dir, missionId))).toBe(true)
})

test("delivery_review rejects when no active delivery", async () => {
  const pluginInput = { directory: dir, client: {} } as unknown as PluginInput
  const { getRegistryStore } = await import("../src/registry/context.ts")
  const store = await getRegistryStore(pluginInput)
  store.registerOuterSession({ sessionId: "ses_lead", profile: "lead" })

  const review = deliveryReviewTool(pluginInput)
  const result = toolOutput(
    await review.execute(
      { mission_id: "ghost", decision: "revision_requested", failed_criteria: [0], revision_brief: "fix" },
      mockToolContext(dir, "ses_lead", "lead"),
    ),
  )
  expect(result).toContain("DELIVERY_REVIEW_FAILED")
})
