import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { sampleMissionManifest } from "./helpers/mission-fixtures.ts"
import { orchestrationProblemNodeIds, initOrchestrationState } from "../src/orchestration/state.ts"
import {
  allSessionsIdle,
  checkExecutionWatchdogMission,
} from "../src/watchdog/mission-watchdog.ts"
import { WATCHDOG_IDLE_THRESHOLD_MS, WATCHDOG_WAKE_COOLDOWN_MS } from "../src/watchdog/prompt.ts"
import { WATCHDOG_POLL_MS } from "../src/watchdog/tick.ts"
import {
  isInnerNotifyingLead,
  isSendToMissionMember,
  mergeWatchdogTickState,
  watchdogDeliveryEventState,
  watchdogSendMessageState,
} from "../src/watchdog/signals.ts"
import {
  bindWatchdogStateStore,
  deleteMissionWatchState,
  getMissionWatchState,
  pruneWatchdogStates,
  resetWatchdogStateStoreForTests,
  setMissionWatchState,
} from "../src/watchdog/state-store.ts"
import { MissionWatchdog } from "../src/watchdog/mission-watchdog.ts"
import { ORCHESTRATION_STALL_THRESHOLD_MS } from "../src/orchestration/stall.ts"
import {
  ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS,
  ORCHESTRATION_STALL_RESUME_COOLDOWN_MS,
} from "../src/watchdog/orchestration-stall.ts"
import { watchdogIdleTickDecision, watchdogNodeIdleTickDecision } from "../src/watchdog/tick.ts"
import type { RegistryAgent } from "../src/registry/types.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { seedTerminalPlan } from "./seed-terminal-plan.ts"

const sampleManifest = sampleMissionManifest({
  mission_id: "mission-a",
  status: "running",
  terminal_node: "root",
  nodes: {
    root: { session_id: "ses_root", profile: "build" },
    leaf: { session_id: "ses_leaf", profile: "build" },
  },
})

describe("execution watchdog helpers", () => {
  test("allSessionsIdle treats absent sessions as idle (OpenCode status API omits idle)", () => {
    expect(allSessionsIdle(new Map(), ["ses_root", "ses_leaf"])).toBe(true)

    const statusMap = new Map([
      ["ses_root", "idle"],
      ["ses_leaf", "idle"],
    ] as const)
    expect(allSessionsIdle(statusMap, ["ses_root", "ses_leaf"])).toBe(true)

    const busyMap = new Map([
      ["ses_root", "idle"],
      ["ses_leaf", "busy"],
    ] as const)
    expect(allSessionsIdle(busyMap, ["ses_root", "ses_leaf"])).toBe(false)
    expect(allSessionsIdle(statusMap, [])).toBe(false)
  })

  test("orchestrationProblemNodeIds includes running and rework only", () => {
    const state = initOrchestrationState("mission-a", ["root", "leaf"])
    state.nodes.root = { status: "running" }
    state.nodes.leaf = { status: "done" }
    expect(orchestrationProblemNodeIds(state)).toEqual(["root"])
    state.nodes.leaf = { status: "rework" }
    expect(orchestrationProblemNodeIds(state)).toEqual(["root", "leaf"])
    state.nodes.root = { status: "blocked" }
    expect(orchestrationProblemNodeIds(state)).toEqual(["leaf"])
  })

  test("watchdogNodeIdleTickDecision resets when session is active", () => {
    const decision = watchdogNodeIdleTickDecision({
      now: 20_000,
      sessionIdle: false,
      nodeState: { idleSince: 5_000, lastWakeAt: 1_000 },
    })
    expect(decision.action).toBe("reset")
    expect(decision.nextNodeState).toEqual({})
  })

  test("watchdogNodeIdleTickDecision waits until idle threshold", () => {
    const decision = watchdogNodeIdleTickDecision({
      now: 14_000,
      sessionIdle: true,
      nodeState: undefined,
      idleThresholdMs: WATCHDOG_IDLE_THRESHOLD_MS,
    })
    expect(decision.action).toBe("wait")
    expect(decision.nextNodeState.idleSince).toBe(14_000)
  })

  test("watchdogNodeIdleTickDecision wakes after idle threshold", () => {
    const decision = watchdogNodeIdleTickDecision({
      now: 20_000,
      sessionIdle: true,
      nodeState: { idleSince: 9_000 },
      idleThresholdMs: WATCHDOG_IDLE_THRESHOLD_MS,
    })
    expect(decision.action).toBe("wake")
    expect(decision.idleDurationMs).toBe(11_000)
  })

  test("watchdogNodeIdleTickDecision respects wake cooldown", () => {
    const decision = watchdogNodeIdleTickDecision({
      now: 20_000,
      sessionIdle: true,
      nodeState: { idleSince: 0, lastWakeAt: 19_000 },
      idleThresholdMs: WATCHDOG_IDLE_THRESHOLD_MS,
      wakeCooldownMs: WATCHDOG_WAKE_COOLDOWN_MS,
    })
    expect(decision.action).toBe("cooldown")
  })

  test("watchdogIdleTickDecision resets when any session is active", () => {
    const decision = watchdogIdleTickDecision({
      now: 20_000,
      allIdle: false,
      idleSince: 5_000,
      lastWakeAt: 1_000,
    })
    expect(decision.action).toBe("reset")
    expect(decision.nextIdleSince).toBeUndefined()
  })
})

const missionId = "mission-a"

function innerAgent(nodeId: string): RegistryAgent {
  return {
    agentId: `inner:${missionId}:${nodeId}`,
    scope: "inner",
    profile: "build",
    sessionId: `ses_${nodeId}`,
    displayName: nodeId,
    missionId,
    nodeId,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

const leadAgent: RegistryAgent = {
  agentId: "outer:lead",
  scope: "outer",
  profile: "lead",
  sessionId: "ses_lead",
  displayName: "lead",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("watchdog send_message signals", () => {
  test("mergeWatchdogTickState keeps paused", () => {
    expect(mergeWatchdogTickState({ paused: true }, { nodes: { leaf: { idleSince: 1 } } })).toEqual({
      paused: true,
    })
  })

  test("isInnerNotifyingLead matches terminal node to lead", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-terminal-notify-"))
    try {
      seedTerminalPlan(dir, missionId, "root")
      const root = innerAgent("root")
      expect(isInnerNotifyingLead(root, leadAgent, missionId, dir)).toBe(true)
      expect(
        watchdogSendMessageState({}, { missionId, sender: root, recipient: leadAgent, projectDirectory: dir }),
      ).toEqual({ paused: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("isInnerNotifyingLead rejects non-terminal inner senders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-non-terminal-"))
    try {
      seedTerminalPlan(dir, missionId, "root")
      expect(isInnerNotifyingLead(innerAgent("leaf"), leadAgent, missionId, dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("isSendToMissionMember matches inner recipients in mission", () => {
    expect(isSendToMissionMember(innerAgent("leaf"), missionId)).toBe(true)
    expect(isSendToMissionMember(leadAgent, missionId)).toBe(false)
  })

  test("watchdogDeliveryEventState pauses on submit and resumes on revision", () => {
    expect(watchdogDeliveryEventState({}, "submitted")).toEqual({ paused: true })
    expect(watchdogDeliveryEventState({ paused: true }, "revision_requested")).toEqual({})
  })

  test("watchdogSendMessageState pauses on terminal to lead and resumes on tree send", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-pause-resume-"))
    try {
      seedTerminalPlan(dir, missionId, "root")
      const root = innerAgent("root")
      const leaf = innerAgent("leaf")
      const paused = watchdogSendMessageState(
        {},
        { missionId, sender: root, recipient: leadAgent, projectDirectory: dir },
      )
      expect(paused).toEqual({ paused: true })
      const resumed = watchdogSendMessageState(
        paused,
        { missionId, sender: leadAgent, recipient: root, projectDirectory: dir },
      )
      expect(resumed).toEqual({})
      const resumedFromRoot = watchdogSendMessageState(
        paused,
        { missionId, sender: root, recipient: leaf, projectDirectory: dir },
      )
      expect(resumedFromRoot).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("execution watchdog mission check", () => {
  test("wakes only running nodes whose sessions are idle", async () => {
    const dir = `/tmp/gh-watchdog-wake-${Date.now()}`
    const orchState = initOrchestrationState(missionId, ["root", "leaf"])
    orchState.nodes.root = { status: "done" }
    orchState.nodes.leaf = { status: "running" }

    const delivered: string[] = []
    const registry = {
      byAgentId: (agentId: string) => {
        if (agentId === `inner:${missionId}:leaf`) return innerAgent("leaf")
        return undefined
      },
      deliverSystemMessage: async (agent: RegistryAgent) => {
        delivered.push(agent.nodeId!)
        return { status: "sent" as const }
      },
    } as unknown as import("../src/registry/store.ts").RegistryStore

    setMissionWatchState(dir, missionId, { nodes: { leaf: { idleSince: 9_000 } } })

    const result = await checkExecutionWatchdogMission({
      pluginInput: { directory: dir, client: {} } as import("@opencode-ai/plugin").PluginInput,
      registry,
      missionId,
      manifest: sampleManifest,
      orchState,
      statusMap: new Map([["ses_leaf", "idle"]]),
      now: 20_000,
      loadWakePrompt: async () => "wake leaf",
    })

    expect(result.action).toBe("wake")
    expect(result.wakes).toEqual(["leaf"])
    expect(delivered).toEqual(["leaf"])
    expect(getMissionWatchState(dir, missionId)?.nodes?.leaf?.lastWakeAt).toBe(20_000)
    deleteMissionWatchState(dir, missionId)
  })

  test("skips when mission watchdog is paused", async () => {
    const dir = `/tmp/gh-watchdog-paused-${Date.now()}`
    setMissionWatchState(dir, missionId, { paused: true })
    const orchState = initOrchestrationState(missionId, ["leaf"])
    orchState.nodes.leaf = { status: "running" }

    const result = await checkExecutionWatchdogMission({
      pluginInput: { directory: dir, client: {} } as import("@opencode-ai/plugin").PluginInput,
      registry: { byAgentId: () => innerAgent("leaf"), deliverSystemMessage: async () => ({ status: "sent" }) } as never,
      missionId,
      manifest: sampleManifest,
      orchState,
      statusMap: new Map([["ses_leaf", "idle"]]),
      now: 20_000,
      loadWakePrompt: async () => "wake",
    })

    expect(result.action).toBe("paused")
    deleteMissionWatchState(dir, missionId)
  })
})

describe("execution watchdog integration", () => {
  test("recordSendMessage pauses using sender mission id when tool mission_id differs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-pause-"))
    try {
      seedTerminalPlan(dir, missionId, "root")
      const registry = { byAgentId: () => undefined } as unknown as import("../src/registry/store.ts").RegistryStore
    const watchdog = new MissionWatchdog(
      { directory: dir, client: {} } as import("@opencode-ai/plugin").PluginInput,
      registry,
      {
        poll_ms: WATCHDOG_POLL_MS,
        idle_threshold_ms: WATCHDOG_IDLE_THRESHOLD_MS,
        wake_cooldown_ms: WATCHDOG_WAKE_COOLDOWN_MS,
      },
      {
        stall_threshold_ms: ORCHESTRATION_STALL_THRESHOLD_MS,
        notify_cooldown_ms: ORCHESTRATION_STALL_NOTIFY_COOLDOWN_MS,
        resume_cooldown_ms: ORCHESTRATION_STALL_RESUME_COOLDOWN_MS,
      },
    )
    const root = { ...innerAgent("root"), missionId }
    watchdog.recordSendMessage({
      missionId: "wrong-mission",
      sender: root,
      recipient: leadAgent,
    })
    expect(getMissionWatchState(dir, missionId)).toEqual({ paused: true })
    expect(getMissionWatchState(dir, "wrong-mission")).toBeUndefined()
    } finally {
      deleteMissionWatchState(dir, missionId)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("watchdog state persistence", () => {
  test("setMissionWatchState writes per-node idle tracking to registry.db", () => {
    const dir = `/tmp/gh-watchdog-db-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { nodes: { leaf: { idleSince: 42, lastWakeAt: 99 } } })
    expect(db.loadWatchdogStates()).toEqual([
      { missionId: "mission-a", kind: "execution", state: { nodes: { leaf: { idleSince: 42, lastWakeAt: 99 } } } },
    ])
    resetWatchdogStateStoreForTests()
  })

  test("bindWatchdogStateStore hydrates paused state after process restart", () => {
    const dir = `/tmp/gh-watchdog-restart-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { paused: true, nodes: { leaf: { idleSince: 42 } } })
    resetWatchdogStateStoreForTests()

    const db2 = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db2)
    expect(getMissionWatchState(dir, "mission-a")).toEqual({
      paused: true,
      nodes: { leaf: { idleSince: 42 } },
    })
    resetWatchdogStateStoreForTests()
  })

  test("deleteMissionWatchState removes row from registry.db", () => {
    const dir = `/tmp/gh-watchdog-delete-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { paused: true }, "retro_record")
    deleteMissionWatchState(dir, "mission-a", "retro_record")
    expect(db.loadWatchdogStates()).toEqual([])
    resetWatchdogStateStoreForTests()
  })

  test("pruneWatchdogStates removes stale mission rows", () => {
    const dir = `/tmp/gh-watchdog-prune-${Date.now()}`
    bindWatchdogStateStore(dir, new RegistryDatabase(dir))
    setMissionWatchState(dir, "mission-a", { nodes: { leaf: { idleSince: 1 } } })
    setMissionWatchState(dir, "mission-b", { allIdleSince: 2 }, "retro_record")
    pruneWatchdogStates(dir, "execution", ["mission-z"])
    pruneWatchdogStates(dir, "retro_record", [])
    expect(getMissionWatchState(dir, "mission-a")).toBeUndefined()
    expect(getMissionWatchState(dir, "mission-b", "retro_record")).toBeUndefined()
    resetWatchdogStateStoreForTests()
  })

  test("bindWatchdogStateStore replaces stale in-memory keys for directory", () => {
    const dir = `/tmp/gh-watchdog-rebind-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { paused: true })
    resetWatchdogStateStoreForTests()

    bindWatchdogStateStore(dir, db)
    expect(getMissionWatchState(dir, "mission-a")).toEqual({ paused: true })

    db.deleteWatchdogState("mission-a", "execution")
    bindWatchdogStateStore(dir, db)
    expect(getMissionWatchState(dir, "mission-a")).toBeUndefined()
    resetWatchdogStateStoreForTests()
  })
})
