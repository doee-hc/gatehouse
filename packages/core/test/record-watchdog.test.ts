import { describe, expect, test } from "bun:test"
import type { RegistryAgent } from "../src/registry/types.ts"
import { retroAgentId, innerAgentId } from "../src/registry/types.ts"
import {
  checkRecordWatchdogMission,
  expectedSessionIds,
  pendingSessionIds,
  type IncompleteRecordRun,
} from "../src/watchdog/record-watchdog.ts"
import { WATCHDOG_IDLE_THRESHOLD_MS } from "../src/watchdog/prompt.ts"
import { deleteMissionWatchState, getMissionWatchState, setMissionWatchState } from "../src/watchdog/state-store.ts"
import type { RegistryStore } from "../src/registry/store.ts"
import type { PluginInput } from "@opencode-ai/plugin"

const missionId = "m1"

function retroAnalystAgent(): RegistryAgent {
  return {
    agentId: retroAgentId(missionId),
    scope: "retro",
    profile: "retro-analyst",
    sessionId: "ses_retro_analyst",
    displayName: "[retro] m1",
    missionId,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function execAgent(nodeId: string): RegistryAgent {
  return {
    agentId: innerAgentId(missionId, nodeId),
    scope: "inner",
    profile: "build",
    sessionId: `ses_exec_${nodeId}`,
    displayName: nodeId,
    missionId,
    nodeId,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function mockRegistry(agents: RegistryAgent[]) {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]))
  return {
    byAgentId: (agentId: string) => byId.get(agentId),
    deliverSystemMessage: async () => ({ status: "sent" as const }),
  } as unknown as RegistryStore
}

const retroRun: IncompleteRecordRun = {
  missionId,
  expectedNodeIds: ["retro-analyst"],
  pendingNodeIds: ["retro-analyst"],
}

describe("record watchdog helpers", () => {
  test("expectedSessionIds collects retro analyst session", () => {
    const registry = mockRegistry([retroAnalystAgent()])
    expect(
      expectedSessionIds(registry, retroRun, (mid) => registry.byAgentId(retroAgentId(mid))),
    ).toEqual(["ses_retro_analyst"])
  })

  test("pendingSessionIds collects retro analyst session", () => {
    const registry = mockRegistry([retroAnalystAgent()])
    expect(
      pendingSessionIds(retroRun, (mid) => registry.byAgentId(retroAgentId(mid))),
    ).toEqual(["ses_retro_analyst"])
  })

  test("checkRecordWatchdogMission wakes retro analyst when idle", async () => {
    const dir = `/tmp/gh-record-wd-retro-idle-${Date.now()}`
    const notified: string[] = []
    const registry = {
      byAgentId: (agentId: string) =>
        agentId === retroAgentId(missionId) ? retroAnalystAgent() : undefined,
      deliverSystemMessage: async (agent: RegistryAgent) => {
        notified.push(agent.agentId)
        return { status: "sent" as const }
      },
    } as unknown as RegistryStore

    const idleMap = new Map([["ses_retro_analyst", "idle"]] as const)
    const allIdleSince = 20_000 - WATCHDOG_IDLE_THRESHOLD_MS - 1_000

    setMissionWatchState(dir, missionId, { allIdleSince }, "retro_record")

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: retroRun,
      kind: "retro_record",
      statusMap: idleMap,
      now: 20_000,
      resolveAgent: (mid) => registry.byAgentId(retroAgentId(mid)),
      loadWakePrompt: async (_dir, params) => `wake:${params.nodeId}`,
    })

    expect(result.action).toBe("wake")
    expect(notified).toEqual([retroAgentId(missionId)])
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission does not set lastWakeAt when delivery fails", async () => {
    const dir = `/tmp/gh-record-wd-fail-${Date.now()}`
    const registry = {
      byAgentId: (agentId: string) =>
        agentId === retroAgentId(missionId) ? retroAnalystAgent() : undefined,
      deliverSystemMessage: async () => ({ status: "failed" as const }),
    } as unknown as RegistryStore

    const idleMap = new Map([["ses_retro_analyst", "idle"]] as const)
    const allIdleSince = 20_000 - WATCHDOG_IDLE_THRESHOLD_MS - 1_000
    setMissionWatchState(dir, missionId, { allIdleSince }, "retro_record")

    await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: retroRun,
      kind: "retro_record",
      statusMap: idleMap,
      now: 20_000,
      resolveAgent: (mid) => registry.byAgentId(retroAgentId(mid)),
      loadWakePrompt: async () => "wake",
    })

    expect(getMissionWatchState(dir, missionId, "retro_record")).toEqual({ allIdleSince })
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission waits until retro analyst is idle", async () => {
    const dir = `/tmp/gh-record-wd-wait-${Date.now()}`
    const registry = mockRegistry([retroAnalystAgent()])
    const busyMap = new Map([["ses_retro_analyst", "busy"]] as const)

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: retroRun,
      kind: "retro_record",
      statusMap: busyMap,
      now: 20_000,
      resolveAgent: (mid) => registry.byAgentId(retroAgentId(mid)),
      loadWakePrompt: async () => "wake",
    })
    expect(result.action).toBe("reset")
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission clears state when no pending nodes", async () => {
    const dir = `/tmp/gh-record-wd-done-${Date.now()}`
    setMissionWatchState(dir, missionId, { allIdleSince: 0 }, "skill_record")
    const registry = mockRegistry([execAgent("node-a")])

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: { missionId, expectedNodeIds: ["node-a"], pendingNodeIds: [] },
      kind: "skill_record",
      statusMap: new Map(),
      now: 20_000,
      resolveAgent: (mid, nodeId) => registry.byAgentId(innerAgentId(mid, nodeId)),
      loadWakePrompt: async () => "wake",
    })

    expect(result.action).toBe("complete")
    expect(getMissionWatchState(dir, missionId, "skill_record")).toBeUndefined()
  })
})
