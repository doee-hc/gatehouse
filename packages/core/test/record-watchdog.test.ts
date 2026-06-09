import { describe, expect, test } from "bun:test"
import type { RegistryAgent } from "../src/registry/types.ts"
import { retroAgentId, innerAgentId } from "../src/registry/types.ts"
import {
  checkRecordWatchdogMission,
  expectedSessionIds,
  pendingSessionIds,
  type IncompleteRecordRun,
} from "../src/watchdog/record-watchdog.ts"
import { EXECUTION_TREE_IDLE_THRESHOLD_MS } from "../src/watchdog/prompt.ts"
import { deleteMissionWatchState, getMissionWatchState, setMissionWatchState } from "../src/watchdog/state-store.ts"
import type { RegistryStore } from "../src/registry/store.ts"
import type { PluginInput } from "@opencode-ai/plugin"

const missionId = "m1"

function retroAgent(nodeId: string): RegistryAgent {
  return {
    agentId: retroAgentId(missionId, nodeId),
    scope: "retro",
    profile: "build-coordinator",
    sessionId: `ses_retro_${nodeId}`,
    displayName: nodeId,
    missionId,
    nodeId,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function execAgent(nodeId: string): RegistryAgent {
  return {
    agentId: innerAgentId(missionId, nodeId),
    scope: "inner",
    profile: "build-coordinator",
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

const run: IncompleteRecordRun = {
  missionId,
  expectedNodeIds: ["node-a", "node-b"],
  pendingNodeIds: ["node-b"],
}

describe("record watchdog helpers", () => {
  test("expectedSessionIds collects sessions for all expected nodes", () => {
    const registry = mockRegistry([retroAgent("node-a"), retroAgent("node-b")])
    expect(
      expectedSessionIds(registry, run, (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId))),
    ).toEqual(["ses_retro_node-a", "ses_retro_node-b"])
  })

  test("pendingSessionIds only collects sessions for pending nodes", () => {
    const registry = mockRegistry([retroAgent("node-a"), retroAgent("node-b")])
    expect(
      pendingSessionIds(run, (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId))),
    ).toEqual(["ses_retro_node-b"])
  })

  test("checkRecordWatchdogMission ignores completed nodes when checking idle", async () => {
    const dir = `/tmp/gh-record-wd-pending-idle-${Date.now()}`
    const notified: string[] = []
    const registry = {
      byAgentId: (agentId: string) =>
        agentId === retroAgentId(missionId, "node-a")
          ? retroAgent("node-a")
          : agentId === retroAgentId(missionId, "node-b")
            ? retroAgent("node-b")
            : undefined,
      deliverSystemMessage: async (agent: RegistryAgent) => {
        notified.push(agent.nodeId ?? agent.agentId)
        return { status: "sent" as const }
      },
    } as unknown as RegistryStore

    const idleMap = new Map([
      ["ses_retro_node-a", "busy"],
      ["ses_retro_node-b", "idle"],
    ] as const)
    const allIdleSince = 20_000 - EXECUTION_TREE_IDLE_THRESHOLD_MS - 1_000

    setMissionWatchState(dir, missionId, { allIdleSince }, "retro_record")

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run,
      kind: "retro_record",
      statusMap: idleMap,
      now: 20_000,
      resolveAgent: (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId)),
      loadWakePrompt: async (_dir, params) => `wake:${params.nodeId}`,
    })

    expect(result.action).toBe("wake")
    expect(notified).toEqual(["node-b"])
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission does not set lastWakeAt when delivery fails", async () => {
    const dir = `/tmp/gh-record-wd-fail-${Date.now()}`
    const registry = {
      byAgentId: (agentId: string) =>
        agentId === retroAgentId(missionId, "node-b") ? retroAgent("node-b") : undefined,
      deliverSystemMessage: async () => ({ status: "failed" as const }),
    } as unknown as RegistryStore

    const idleMap = new Map([["ses_retro_node-b", "idle"]] as const)
    const allIdleSince = 20_000 - EXECUTION_TREE_IDLE_THRESHOLD_MS - 1_000
    setMissionWatchState(dir, missionId, { allIdleSince }, "retro_record")

    await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: { ...run, expectedNodeIds: ["node-b"], pendingNodeIds: ["node-b"] },
      kind: "retro_record",
      statusMap: idleMap,
      now: 20_000,
      resolveAgent: (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId)),
      loadWakePrompt: async () => "wake",
    })

    expect(getMissionWatchState(dir, missionId, "retro_record")).toEqual({ allIdleSince })
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission waits until all expected sessions idle for threshold", async () => {
    const dir = `/tmp/gh-record-wd-wait-${Date.now()}`
    const registry = mockRegistry([retroAgent("node-a"), retroAgent("node-b")])
    const busyMap = new Map([
      ["ses_retro_node-a", "idle"],
      ["ses_retro_node-b", "busy"],
    ] as const)

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run,
      kind: "retro_record",
      statusMap: busyMap,
      now: 20_000,
      resolveAgent: (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId)),
      loadWakePrompt: async () => "wake",
    })
    expect(result.action).toBe("reset")
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission notifies pending agents after idle threshold", async () => {
    const dir = `/tmp/gh-record-wd-wake-${Date.now()}`
    const notified: string[] = []
    const registry = {
      byAgentId: (agentId: string) =>
        agentId === retroAgentId(missionId, "node-a")
          ? retroAgent("node-a")
          : agentId === retroAgentId(missionId, "node-b")
            ? retroAgent("node-b")
            : undefined,
      deliverSystemMessage: async (agent: RegistryAgent) => {
        notified.push(agent.nodeId ?? agent.agentId)
        return { status: "sent" as const }
      },
    } as unknown as RegistryStore

    const idleMap = new Map([
      ["ses_retro_node-a", "idle"],
      ["ses_retro_node-b", "idle"],
    ] as const)
    const allIdleSince = 20_000 - EXECUTION_TREE_IDLE_THRESHOLD_MS - 1_000

    setMissionWatchState(dir, missionId, { allIdleSince }, "retro_record")

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run,
      kind: "retro_record",
      statusMap: idleMap,
      now: 20_000,
      resolveAgent: (mid, nodeId) => registry.byAgentId(retroAgentId(mid, nodeId)),
      loadWakePrompt: async (_dir, params) => `wake:${params.nodeId}`,
    })

    expect(result.action).toBe("wake")
    expect(notified).toEqual(["node-b"])
    deleteMissionWatchState(dir, missionId, "retro_record")
  })

  test("checkRecordWatchdogMission clears state when no pending nodes", async () => {
    const dir = `/tmp/gh-record-wd-done-${Date.now()}`
    setMissionWatchState(dir, missionId, { allIdleSince: 0 }, "skill_record")
    const registry = mockRegistry([execAgent("node-a")])

    const result = await checkRecordWatchdogMission({
      pluginInput: { directory: dir, client: {} } as PluginInput,
      registry,
      run: { ...run, pendingNodeIds: [] },
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
