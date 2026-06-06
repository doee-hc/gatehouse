import { describe, expect, test } from "bun:test"
import { parseTreeManifest } from "../src/tree/parse.ts"
import {
  allSessionsIdle,
  manifestSessionIds,
  watchdogTickDecision,
} from "../src/watchdog/execution-tree.ts"
import {
  EXECUTION_TREE_IDLE_THRESHOLD_MS,
  EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS,
} from "../src/watchdog/prompt.ts"
import {
  isInnerNotifyingLead,
  isSendToTreeMember,
  mergeWatchdogTickState,
  watchdogSendMessageState,
} from "../src/watchdog/signals.ts"
import {
  bindWatchdogStateStore,
  deleteMissionWatchState,
  getMissionWatchState,
  resetWatchdogStateStoreForTests,
  setMissionWatchState,
} from "../src/watchdog/state-store.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { ExecutionTreeWatchdog } from "../src/watchdog/execution-tree.ts"
import type { RegistryAgent } from "../src/registry/types.ts"

const sampleManifest = parseTreeManifest(`
mission_id: mission-a
status: running
root_node: root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  root:
    session_id: ses_root
    parent: null
  leaf:
    session_id: ses_leaf
    parent: root
`)

describe("execution tree watchdog", () => {
  test("manifestSessionIds collects all node sessions", () => {
    expect(manifestSessionIds(sampleManifest)).toEqual(["ses_root", "ses_leaf"])
  })

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

  test("watchdogTickDecision resets when any session is active", () => {
    const decision = watchdogTickDecision({
      now: 20_000,
      allIdle: false,
      state: { allIdleSince: 5_000, lastWakeAt: 1_000 },
    })
    expect(decision.action).toBe("reset")
    expect(decision.nextState).toEqual({})
  })

  test("watchdogTickDecision waits until idle threshold", () => {
    const decision = watchdogTickDecision({
      now: 14_000,
      allIdle: true,
      state: {},
      idleThresholdMs: EXECUTION_TREE_IDLE_THRESHOLD_MS,
    })
    expect(decision.action).toBe("wait")
    if (decision.action === "wait") expect(decision.nextState.allIdleSince).toBe(14_000)
  })

  test("watchdogTickDecision wakes after idle threshold", () => {
    const decision = watchdogTickDecision({
      now: 20_000,
      allIdle: true,
      state: { allIdleSince: 9_000 },
      idleThresholdMs: EXECUTION_TREE_IDLE_THRESHOLD_MS,
    })
    expect(decision.action).toBe("wake")
    expect(decision.idleDurationMs).toBe(11_000)
  })

  test("watchdogTickDecision respects wake cooldown", () => {
    const decision = watchdogTickDecision({
      now: 20_000,
      allIdle: true,
      state: { allIdleSince: 0, lastWakeAt: 19_000 },
      idleThresholdMs: EXECUTION_TREE_IDLE_THRESHOLD_MS,
      wakeCooldownMs: EXECUTION_TREE_WATCHDOG_WAKE_COOLDOWN_MS,
    })
    expect(decision.action).toBe("cooldown")
  })

  test("watchdogTickDecision preserves paused across wake", () => {
    const decision = watchdogTickDecision({
      now: 20_000,
      allIdle: true,
      state: { paused: true, allIdleSince: 0 },
      idleThresholdMs: EXECUTION_TREE_IDLE_THRESHOLD_MS,
    })
    expect(decision.action).toBe("wake")
    expect(decision.nextState).toEqual({ paused: true })
  })
})

const missionId = "mission-a"

function innerAgent(nodeId: string, parentSessionId?: string): RegistryAgent {
  return {
    agentId: `inner:${missionId}:${nodeId}`,
    scope: "inner",
    profile: "build",
    sessionId: `ses_${nodeId}`,
    displayName: nodeId,
    missionId,
    nodeId,
    parentSessionId,
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
    expect(mergeWatchdogTickState({ paused: true }, { lastWakeAt: 99 })).toEqual({ paused: true })
  })

  test("isInnerNotifyingLead matches structural root to lead when tool mission_id differs from sender", () => {
    const root = { ...innerAgent("root"), missionId: undefined }
    expect(isInnerNotifyingLead(root, leadAgent, missionId)).toBe(true)
    expect(
      watchdogSendMessageState({}, { missionId, sender: root, recipient: leadAgent }),
    ).toEqual({ paused: true })
  })

  test("isInnerNotifyingLead rejects non-root inner senders", () => {
    expect(isInnerNotifyingLead(innerAgent("leaf", "ses_root"), leadAgent, missionId)).toBe(false)
  })

  test("isSendToTreeMember matches inner recipients in mission", () => {
    expect(isSendToTreeMember(innerAgent("leaf", "ses_root"), missionId)).toBe(true)
    expect(isSendToTreeMember(leadAgent, missionId)).toBe(false)
  })

  test("watchdogSendMessageState pauses on root to lead and resumes on tree send", () => {
    const root = innerAgent("root")
    const leaf = innerAgent("leaf", "ses_root")
    const paused = watchdogSendMessageState({}, { missionId, sender: root, recipient: leadAgent })
    expect(paused).toEqual({ paused: true })
    const resumed = watchdogSendMessageState(paused, { missionId, sender: leadAgent, recipient: root })
    expect(resumed).toEqual({})
    const resumedFromRoot = watchdogSendMessageState(paused, { missionId, sender: root, recipient: leaf })
    expect(resumedFromRoot).toEqual({})
  })
})

describe("execution tree watchdog integration", () => {
  test("recordSendMessage pauses using sender mission id when tool mission_id differs", () => {
    const dir = `/tmp/gh-watchdog-pause-${Date.now()}`
    const registry = { byAgentId: () => undefined } as unknown as import("../src/registry/store.ts").RegistryStore
    const watchdog = new ExecutionTreeWatchdog({ directory: dir, client: {} } as import("@opencode-ai/plugin").PluginInput, registry)
    const root = { ...innerAgent("root"), missionId }
    watchdog.recordSendMessage({
      missionId: "wrong-mission",
      sender: root,
      recipient: leadAgent,
    })
    expect(getMissionWatchState(dir, missionId)).toEqual({ paused: true })
    expect(getMissionWatchState(dir, "wrong-mission")).toBeUndefined()
    deleteMissionWatchState(dir, missionId)
  })
})

describe("watchdog state persistence", () => {
  test("setMissionWatchState writes paused flag to registry.db", () => {
    const dir = `/tmp/gh-watchdog-db-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { paused: true })
    expect(db.loadWatchdogStates()).toEqual([
      { missionId: "mission-a", kind: "execution", state: { paused: true } },
    ])
    resetWatchdogStateStoreForTests()
  })

  test("bindWatchdogStateStore hydrates paused state after process restart", () => {
    const dir = `/tmp/gh-watchdog-restart-${Date.now()}`
    const db = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db)
    setMissionWatchState(dir, "mission-a", { paused: true, allIdleSince: 42, lastWakeAt: 99 })
    resetWatchdogStateStoreForTests()

    const db2 = new RegistryDatabase(dir)
    bindWatchdogStateStore(dir, db2)
    expect(getMissionWatchState(dir, "mission-a")).toEqual({
      paused: true,
      allIdleSince: 42,
      lastWakeAt: 99,
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
})
