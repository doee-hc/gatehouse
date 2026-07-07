import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { dryRunMissionScriptSource } from "../src/orchestration/script/validate.ts"
import { resumeOrchestrationRuntime } from "../src/orchestration/lifecycle/resume.ts"
import {
  startSandboxOrchestration,
  stopSandboxOrchestration,
} from "../src/orchestration/sandbox/runtime.ts"
import { writeOrchestrationState } from "../src/orchestration/state/store.ts"
import {
  completeNodes,
  completeRunningNode,
  countPromptMarkers,
  createReplayTestEnv,
  readState,
  SCRIPT,
  seedDoneNode,
  seedDoneNodes,
  seedNodeBriefs,
  waitForAllPromptMarkers,
  waitForCursorAtLeast,
  waitForPromptMarker,
  waitUntil,
} from "./orchestration-replay-harness.ts"

const activeMissions = new Set<string>()

afterEach(() => {
  for (const missionId of activeMissions) stopSandboxOrchestration(missionId)
  activeMissions.clear()
})

describe("complex orchestration scripts validate", () => {
  const cases = [
    ["dualTrackParallelFinal", SCRIPT.dualTrackParallelFinal],
    ["dualTrackIntraFanOut", SCRIPT.dualTrackIntraFanOut],
    ["deepHierarchyFanOut", SCRIPT.deepHierarchyFanOut],
    ["intraFanOutCompoundMultiRound", SCRIPT.intraFanOutCompoundMultiRound],
    ["dualTrackThenRootMultiRound", SCRIPT.dualTrackThenRootMultiRound],
  ] as const

  for (const [name, builder] of cases) {
    test(`${name} passes dry-run and compiles plan`, async () => {
      const missionId = `complex-validate-${name}`
      const result = await dryRunMissionScriptSource(builder(missionId), missionId)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.plan.steps.length).toBeGreaterThanOrEqual(1)
    })
  }
})

describe("orchestration replay complex scenarios", () => {
  test("dual-track parallel: inter-group parallel with per-track serial synthesis", async () => {
    const missionId = "complex-dual-track-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackParallelFinal(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForAllPromptMarkers(env, ["marker:trackA-a1", "marker:trackB-b1"])
      await completeRunningNode(env, "a1")
      await completeRunningNode(env, "b1")
      await Bun.sleep(400)

      await waitForAllPromptMarkers(env, ["marker:trackA-a2", "marker:trackB-b2"])
      await completeNodes(env, ["a2", "b2"])
      await Bun.sleep(400)

      await waitForAllPromptMarkers(env, ["marker:trackA-join", "marker:trackB-join"])
      await completeNodes(env, ["a", "b"])
      await Bun.sleep(400)

      await waitForPromptMarker(env, "marker:final-root")
      await completeRunningNode(env, "terminal")
      await waitForCursorAtLeast(env, 2)

      expect(Object.values(readState(env)?.nodes ?? {}).every((n) => n.status === "done")).toBe(true)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("dual-track parallel resume: done track A skipped, track B still runs", async () => {
    const missionId = "complex-dual-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackParallelFinal(missionId),
    })

    try {
      await seedNodeBriefs(env, {
        a1: { your_work: ["a1"], acceptance_slice: [] },
        a2: { your_work: ["a2"], acceptance_slice: [] },
        a: { your_work: ["synthesize a"], acceptance_slice: [] },
      })
      seedDoneNodes(env, ["a1", "a2", "a"])

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:trackB-b1", { label: "track B starts after track A seeded done" })

      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a2")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:trackA-join")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:trackB-b1")).toBe(1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("dual-track intra fan-out: parallel within each track", async () => {
    const missionId = "complex-intra-fanout-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackIntraFanOut(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForAllPromptMarkers(env, [
        "marker:trackA-a1",
        "marker:trackA-a2",
        "marker:trackB-b1",
        "marker:trackB-b2",
      ])

      await completeNodes(env, ["a1", "a2", "b1", "b2"])
      await Bun.sleep(500)

      await waitForAllPromptMarkers(env, ["marker:trackA-join", "marker:trackB-join"])
      await completeNodes(env, ["a", "b"])
      await Bun.sleep(400)

      await waitForPromptMarker(env, "marker:final-root")
      await waitForCursorAtLeast(env, 1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("dual-track intra fan-out resume: track A leaves done, only track B fan-out prompts", async () => {
    const missionId = "complex-intra-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackIntraFanOut(missionId),
    })

    try {
      await seedNodeBriefs(env, {
        a1: { your_work: ["a1"], acceptance_slice: [] },
        a2: { your_work: ["a2"], acceptance_slice: [] },
        a: { your_work: ["synthesize a"], acceptance_slice: [] },
      })
      seedDoneNodes(env, ["a1", "a2", "a"])

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForAllPromptMarkers(env, ["marker:trackB-b1", "marker:trackB-b2"])

      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a2")).toBe(0)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("deep hierarchy: leaf fan-out then multi-level synthesis chain", async () => {
    const missionId = "complex-deep-hier-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.deepHierarchyFanOut(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForAllPromptMarkers(env, ["marker:leaf-l1a", "marker:leaf-l1b"])
      await completeNodes(env, ["l1a", "l1b"])
      await Bun.sleep(500)

      await waitForPromptMarker(env, "marker:join-l2")
      await completeRunningNode(env, "l2")
      await Bun.sleep(400)

      await waitForPromptMarker(env, "marker:join-l3")
      await completeRunningNode(env, "l3")
      await Bun.sleep(400)

      await waitForPromptMarker(env, "marker:join-l4")
      await completeRunningNode(env, "l4")

      expect(readState(env)?.cursor_step_index).toBe(3)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("deep hierarchy resume: skips leaf fan-out, continues at mid-level synthesis", async () => {
    const missionId = "complex-deep-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.deepHierarchyFanOut(missionId),
    })

    try {
      seedDoneNodes(env, ["l1a", "l1b"])
      const state = readState(env)!
      state.cursor_step_index = 1
      writeOrchestrationState(env.dir, state)

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:join-l2", { label: "resume at l2 synthesis" })

      expect(countPromptMarkers(env.promptTexts, "marker:leaf-l1a")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:leaf-l1b")).toBe(0)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("intra fan-out + compound multi-round on acceptance layer inside parallel", async () => {
    const missionId = "complex-compound-fan-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.intraFanOutCompoundMultiRound(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForAllPromptMarkers(env, ["marker:fan-x1", "marker:fan-x2"])
      await completeNodes(env, ["x1", "x2"])
      await Bun.sleep(500)

      await waitForPromptMarker(env, "marker:join-r1")
      await completeRunningNode(env, "join")
      await Bun.sleep(600)

      await waitForPromptMarker(env, "marker:join-r2")
      expect(readState(env)?.nodes.join?.round).toBe(2)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("intra fan-out compound resume: skips leaves and round1, prompts round2 only", async () => {
    const missionId = "complex-compound-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.intraFanOutCompoundMultiRound(missionId),
    })

    try {
      await seedNodeBriefs(env, {
        x1: { your_work: ["x1"], acceptance_slice: [] },
        x2: { your_work: ["x2"], acceptance_slice: [] },
        join: { your_work: ["round1"], acceptance_slice: [] },
      })
      seedDoneNodes(env, ["x1", "x2"])
      seedDoneNode(env, "join", { round: 1 })

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:join-r2")

      expect(countPromptMarkers(env.promptTexts, "marker:fan-x1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:fan-x2")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:join-r1")).toBe(0)
      expect(readState(env)?.nodes.join?.round).toBe(2)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("dual-track then root linear multi-round after parallel completes", async () => {
    const missionId = "complex-root-multiround-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackThenRootMultiRound(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForAllPromptMarkers(env, ["marker:track-a", "marker:track-b"])
      await completeNodes(env, ["a", "b"])
      await Bun.sleep(500)

      await waitForPromptMarker(env, "marker:root-w1")
      await completeRunningNode(env, "terminal")
      await Bun.sleep(600)

      await waitForPromptMarker(env, "marker:root-w2")
      expect(readState(env)?.nodes.terminal?.round).toBe(2)
      await completeRunningNode(env, "terminal")
      await waitForCursorAtLeast(env, 3)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("crash during dual-track parallel then resume continues unfinished track", async () => {
    const missionId = "complex-dual-crash-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.dualTrackParallelFinal(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })
      await waitForAllPromptMarkers(env, ["marker:trackA-a1", "marker:trackB-b1"])
      await completeNodes(env, ["a1", "b1"])
      await Bun.sleep(400)
      await waitForAllPromptMarkers(env, ["marker:trackA-a2", "marker:trackB-b2"])
      await completeRunningNode(env, "a2")

      stopSandboxOrchestration(missionId)
      activeMissions.delete(missionId)

      await seedNodeBriefs(env, {
        a1: { your_work: ["a1"], acceptance_slice: [] },
        a2: { your_work: ["a2"], acceptance_slice: [] },
      })
      seedDoneNodes(env, ["a1", "a2"])

      env.promptTexts.length = 0
      activeMissions.add(missionId)
      const resumed = await resumeOrchestrationRuntime(
        env.plugin,
        env.store,
        env.manifest,
        missionId,
      )
      expect(resumed.status).toBe("resumed")

      await waitForPromptMarker(env, "marker:trackB-b2", { label: "track B continues after crash" })
      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:trackA-a2")).toBe(0)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("deep hierarchy crash mid-chain resumes at correct cursor without replaying leaves", async () => {
    const missionId = "complex-deep-crash-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.deepHierarchyFanOut(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })
      await waitForAllPromptMarkers(env, ["marker:leaf-l1a", "marker:leaf-l1b"])
      await completeNodes(env, ["l1a", "l1b"])
      await Bun.sleep(500)
      await waitForPromptMarker(env, "marker:join-l2")
      await completeRunningNode(env, "l2")
      await waitForCursorAtLeast(env, 2)

      stopSandboxOrchestration(missionId)
      activeMissions.delete(missionId)

      expect(readState(env)?.cursor_step_index).toBeGreaterThanOrEqual(2)

      env.promptTexts.length = 0
      activeMissions.add(missionId)
      const resumed = await resumeOrchestrationRuntime(
        env.plugin,
        env.store,
        env.manifest,
        missionId,
      )
      expect(resumed.status).toBe("resumed")

      await waitForPromptMarker(env, "marker:join-l3")
      expect(countPromptMarkers(env.promptTexts, "marker:leaf-l1a")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:join-l2")).toBe(0)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })
})
