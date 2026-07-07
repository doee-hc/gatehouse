import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { buildPortalOrchestration } from "../src/portal/orchestration-view.ts"
import { createMissionHostHandlers } from "../src/orchestration/sandbox/host.ts"
import { saveOrchestrationPlanRecord } from "../src/orchestration/plan/store.ts"
import { advanceReplayCursor } from "../src/orchestration/plan/replay.ts"
import { resumeOrchestrationRuntime } from "../src/orchestration/lifecycle/resume.ts"
import {
  startSandboxOrchestration,
  stopSandboxOrchestration,
} from "../src/orchestration/sandbox/runtime.ts"
import { markNodeRunning, mutateOrchestrationState, writeOrchestrationState } from "../src/orchestration/state/store.ts"
import type { PortalMissionTeam } from "../src/portal/snapshot.ts"
import {
  completeRunningNode,
  countPromptMarkers,
  createReplayTestEnv,
  readState,
  SCRIPT,
  seedDoneNode,
  seedNodeBrief,
  waitForPromptMarker,
  waitUntil,
} from "./orchestration-replay-harness.ts"

const activeMissions = new Set<string>()

afterEach(() => {
  for (const missionId of activeMissions) {
    stopSandboxOrchestration(missionId)
  }
  activeMissions.clear()
})

describe("orchestration replay integration", () => {
  test("linear plan advances cursor as each step completes", async () => {
    const missionId = "replay-linear-advance-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      const started = await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
      })
      expect(started.status).toBe("started")

      await waitForPromptMarker(env, "marker:step0-n1", { label: "step0 prompt" })
      await completeRunningNode(env, "n1")

      await waitUntil(() => (readState(env)?.cursor_step_index ?? 0) >= 1, {
        label: "cursor after step0",
      })
      await waitForPromptMarker(env, "marker:step1-n2", { label: "step1 prompt" })

      expect(readState(env)?.cursor_step_index).toBe(1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("resume from cursor skips earlier linear steps", async () => {
    const missionId = "replay-linear-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      seedDoneNode(env, "n1")
      seedDoneNode(env, "n2")
      const state = readState(env)!
      state.cursor_step_index = 2
      writeOrchestrationState(env.dir, state)

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:step2-n3", { label: "step2 only prompt" })

      expect(countPromptMarkers(env.promptTexts, "marker:step0-n1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:step1-n2")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:step2-n3")).toBe(1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("linear multi-round prompts done node on a new plan step", async () => {
    const missionId = "replay-linear-multiround-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearMultiRound(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForPromptMarker(env, "marker:wave1")
      await completeRunningNode(env, "a")
      await Bun.sleep(600)
      await waitForPromptMarker(env, "marker:wave2")

      const state = readState(env)
      expect(state?.nodes.a?.round).toBe(2)
      expect(state?.nodes.a?.status).toBe("running")
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("parallel compound replay skips already-done nodes on resume", async () => {
    const missionId = "replay-parallel-skip-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelThenFinal(missionId),
    })

    try {
      await seedNodeBrief(env, "a1", { your_work: ["a1"], acceptance_slice: [] })
      seedDoneNode(env, "a1")

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:parallel-a2", { label: "parallel a2 prompt after resume" })

      expect(countPromptMarkers(env.promptTexts, "marker:parallel-a1")).toBe(0)
      expect(countPromptMarkers(env.promptTexts, "marker:parallel-a2")).toBe(1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("compound replay on resume skips first round and prompts second", async () => {
    const missionId = "replay-compound-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelMultiRoundSameNode(missionId),
    })

    try {
      await seedNodeBrief(env, "a", { your_work: ["round1"], acceptance_slice: [] })
      seedDoneNode(env, "a", { round: 1 })

      await startSandboxOrchestration({
        plugin: env.plugin,
        store: env.store,
        script: env.script,
        resume: true,
      })

      await waitForPromptMarker(env, "marker:compound-r2", {
        label: "compound round2 after resume with done node",
      })

      expect(countPromptMarkers(env.promptTexts, "marker:compound-r1")).toBe(0)
      expect(readState(env)?.nodes.a?.round).toBe(2)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("live parallel multi-round re-prompts after first round completes", async () => {
    const missionId = "replay-parallel-live-multiround-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelMultiRoundSameNode(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForPromptMarker(env, "marker:compound-r1")
      await completeRunningNode(env, "a")
      await Bun.sleep(600)
      await waitForPromptMarker(env, "marker:compound-r2")

      expect(readState(env)?.nodes.a?.round).toBe(2)
      expect(readState(env)?.nodes.a?.status).toBe("running")
      expect(readState(env)?.compound_replay?.reactivated ?? []).not.toContain("a")
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("fan-out join synthesis runs through all plan steps", async () => {
    const missionId = "replay-fanout-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.fanOutJoin(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })

      await waitForPromptMarker(env, "marker:fanout-a", { label: "fanout a" })
      await waitForPromptMarker(env, "marker:fanout-b", { label: "fanout b" })

      await completeRunningNode(env, "a")
      await completeRunningNode(env, "b")
      await Bun.sleep(600)

      await waitForPromptMarker(env, "marker:join-root", { label: "join prompt" })
      await completeRunningNode(env, "terminal")

      await waitUntil(() => (readState(env)?.cursor_step_index ?? 0) >= 2, {
        label: "all steps complete",
      })
      expect(Object.values(readState(env)?.nodes ?? {}).every((node) => node.status === "done")).toBe(true)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("crash mid-plan then resumeOrchestrationRuntime continues", async () => {
    const missionId = "replay-crash-resume-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      await startSandboxOrchestration({ plugin: env.plugin, store: env.store, script: env.script })
      await waitForPromptMarker(env, "marker:step0-n1")
      await completeRunningNode(env, "n1")
      await Bun.sleep(600)
      await waitForPromptMarker(env, "marker:step1-n2")

      stopSandboxOrchestration(missionId)
      activeMissions.delete(missionId)

      const mid = readState(env)
      expect(mid?.cursor_step_index).toBe(1)

      env.promptTexts.length = 0
      activeMissions.add(missionId)
      const resumed = await resumeOrchestrationRuntime(
        env.plugin,
        env.store,
        env.manifest,
        missionId,
      )
      expect(resumed.status).toBe("resumed")

      await waitForPromptMarker(env, "marker:step1-n2", { label: "step1 after crash resume" })
      expect(countPromptMarkers(env.promptTexts, "marker:step0-n1")).toBe(0)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("resumeOrchestrationRuntime rejects when all nodes done", async () => {
    const missionId = "replay-not-resumable-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearMultiRound(missionId),
    })

    try {
      const state = readState(env)!
      for (const nodeId of Object.keys(state.nodes)) {
        state.nodes[nodeId] = { status: "done", completed_at: new Date().toISOString() }
      }
      writeOrchestrationState(env.dir, state)

      const result = await resumeOrchestrationRuntime(
        env.plugin,
        env.store,
        env.manifest,
        missionId,
      )
      expect(result.status).toBe("not_resumable")
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("resumeOrchestrationRuntime rejects script hash drift", async () => {
    const missionId = "replay-hash-m1"
    activeMissions.add(missionId)
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      mutateOrchestrationState(env.dir, missionId, (state) => {
        state.sandbox = { status: "stopped", script_hash: "deadbeefdeadbeef" }
        markNodeRunning(state, "n1")
      })

      const result = await resumeOrchestrationRuntime(
        env.plugin,
        env.store,
        env.manifest,
        missionId,
      )
      expect(result.status).toBe("error")
      if (result.status === "error") {
        expect(result.message).toContain("mission.script.ts changed")
      }
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("portal view reflects replay cursor and node status", async () => {
    const missionId = "replay-portal-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      if (!env.script.plan) throw new Error("missing plan")
      saveOrchestrationPlanRecord(env.dir, env.script.plan)

      const state = readState(env)!
      state.cursor_step_index = 1
      markNodeRunning(state, "n2")
      writeOrchestrationState(env.dir, state)

      const team: PortalMissionTeam = {
        mission_id: missionId,
        terminal_node: "n3",
        status: "running",
        nodes: [
          { node_id: "n3", session_id: "ses_n3", display_name: "N3" },
          { node_id: "n2", session_id: "ses_n2", display_name: "N2" },
          { node_id: "n1", session_id: "ses_n1", display_name: "N1" },
        ],
      }

      const view = buildPortalOrchestration(env.dir, team)
      expect(view?.cursor_step_index).toBe(1)
      expect(view?.completed_steps).toBe(1)
      expect(view?.steps.find((step) => step.id === "step-0")?.state).toBe("done")
      expect(view?.steps.find((step) => step.id === "step-1")?.state).toBe("current")
      expect(view?.nodes.find((node) => node.node_id === "n2")?.status).toBe("running")
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })
})

describe("orchestration replay host rpc sequences", () => {
  test("stepComplete advances cursor and clears compound latch for that step", async () => {
    const missionId = "replay-host-stepcomplete-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelMultiRoundSameNode(missionId),
    })

    try {
      if (!env.script.plan) throw new Error("missing plan")
      saveOrchestrationPlanRecord(env.dir, env.script.plan)

      const host = createMissionHostHandlers({
        plugin: env.plugin,
        store: env.store,
        team: env.script.team,
      })

      mutateOrchestrationState(env.dir, missionId, (state) => {
        state.compound_replay = { step_id: "step-0", reactivated: ["a"] }
      })

      await host.handleRpc({
        type: "rpc",
        id: "1",
        op: "stepComplete",
        stepId: "step-0",
        stepIndex: 0,
      })

      const state = readState(env)
      expect(state?.cursor_step_index).toBe(1)
      expect(state?.compound_replay).toBeUndefined()
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("RPCs for already-completed steps are ignored", async () => {
    const missionId = "replay-host-skip-step-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.linearThreeStep(missionId),
    })

    try {
      if (!env.script.plan) throw new Error("missing plan")
      saveOrchestrationPlanRecord(env.dir, env.script.plan)

      const host = createMissionHostHandlers({
        plugin: env.plugin,
        store: env.store,
        team: env.script.team,
      })

      mutateOrchestrationState(env.dir, missionId, (state) => {
        advanceReplayCursor(state, "step-0", 0, env.script.plan!.steps)
      })

      await host.handleRpc({
        type: "rpc",
        id: "1",
        op: "prompt",
        nodeIds: ["n1"],
        input: { text: "should-not-deliver", reply: true },
        stepId: "step-0",
        stepIndex: 0,
      })
      await env.store.flushPendingDeliveries()

      expect(env.promptTexts).toEqual([])
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("parallel step with done node skips duplicate prompt unless latch armed", async () => {
    const missionId = "replay-host-parallel-skip-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelThenFinal(missionId),
    })

    try {
      if (!env.script.plan) throw new Error("missing plan")
      saveOrchestrationPlanRecord(env.dir, env.script.plan)

      const host = createMissionHostHandlers({
        plugin: env.plugin,
        store: env.store,
        team: env.script.team,
      })

      seedDoneNode(env, "a1")
      await seedNodeBrief(env, "a1", { your_work: ["a1"], acceptance_slice: [] })

      await host.handleRpc({
        type: "rpc",
        id: "1",
        op: "prompt",
        nodeIds: ["a1"],
        input: { text: "marker:skip-a1", reply: true },
        stepId: "step-0",
        stepIndex: 0,
      })
      await env.store.flushPendingDeliveries()
      expect(countPromptMarkers(env.promptTexts, "marker:skip-a1")).toBe(0)

      mutateOrchestrationState(env.dir, missionId, (state) => {
        state.compound_replay = { step_id: "step-0", reactivated: ["a1"] }
      })

      await host.handleRpc({
        type: "rpc",
        id: "2",
        op: "prompt",
        nodeIds: ["a1"],
        input: { text: "marker:allow-a1", reply: true },
        stepId: "step-0",
        stepIndex: 0,
      })
      await env.store.flushPendingDeliveries()
      expect(countPromptMarkers(env.promptTexts, "marker:allow-a1")).toBe(1)
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })

  test("setBrief with changed brief arms persisted compound_replay latch", async () => {
    const missionId = "replay-host-latch-arm-m1"
    const env = await createReplayTestEnv({
      missionId,
      scriptSource: SCRIPT.parallelMultiRoundSameNode(missionId),
    })

    try {
      if (!env.script.plan) throw new Error("missing plan")
      saveOrchestrationPlanRecord(env.dir, env.script.plan)

      const host = createMissionHostHandlers({
        plugin: env.plugin,
        store: env.store,
        team: env.script.team,
      })

      seedDoneNode(env, "a", { round: 1 })

      await host.handleRpc({
        type: "rpc",
        id: "1",
        op: "setBrief",
        nodeId: "a",
        partial: { your_work: ["round2"], acceptance_slice: [] },
        stepId: "step-0",
        stepIndex: 0,
      })

      expect(readState(env)?.compound_replay).toEqual({
        step_id: "step-0",
        reactivated: ["a"],
      })
    } finally {
      await rm(env.dir, { recursive: true, force: true })
    }
  })
})
