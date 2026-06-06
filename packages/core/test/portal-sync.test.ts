import { describe, expect, test } from "bun:test"
import { classifyToolActivity, portalAgentStatus } from "../src/portal/activity.ts"
import { agentSync, resetAgentSyncForTests } from "../src/portal/agent-sync.ts"
import {
  deliverPortalEvent,
  emitPortalEvent,
  setPortalInProcessDelivery,
  subscribePortalEvents,
} from "../src/portal/events.ts"

describe("portal activity", () => {
  test("maps rag tools to research while busy", () => {
    expect(classifyToolActivity("rag_knowledge_search")).toBe("reading")
    expect(portalAgentStatus({ sessionStatus: "busy", lastTool: "rag_knowledge_search" })).toBe("research")
    expect(portalAgentStatus({ sessionStatus: "busy", lastTool: "edit" })).toBe("busy")
    expect(portalAgentStatus({ sessionStatus: "idle" })).toBe("idle")
  })
})

describe("portal agent sync", () => {
  test("maps session status to agent.status by spawn id", async () => {
    resetAgentSyncForTests()
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    const sync = agentSync("/tmp/portal-agent-sync-test")
    sync.sessionToSpawn.set("ses_architect", "architect")
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_architect", status: { type: "busy" } },
    })
    unsubscribe()
    expect(seen).toEqual([{ type: "agent.status", agentId: "architect", status: "busy" }])
    expect(sync.liveStatus("architect")).toBe("busy")
  })

  test("dedupes repeated session.status for the same spawn", async () => {
    resetAgentSyncForTests()
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    const sync = agentSync("/tmp/portal-agent-sync-test-dedupe")
    sync.sessionToSpawn.set("ses_lead", "lead")
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "busy" } },
    })
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "busy" } },
    })
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "idle" } },
    })
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "idle" } },
    })
    await Bun.sleep(450)
    unsubscribe()
    expect(seen).toEqual([
      { type: "agent.status", agentId: "lead", status: "busy" },
      { type: "agent.status", agentId: "lead", status: "idle" },
    ])
    sync.clearPendingTimers()
  })

  test("defers idle blips between back-to-back busy in one turn", async () => {
    resetAgentSyncForTests()
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    const sync = agentSync("/tmp/portal-agent-sync-test-settle")
    sync.sessionToSpawn.set("ses_lead", "lead")
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "busy" } },
    })
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "idle" } },
    })
    await sync.handleOpencodeEvent({
      type: "session.status",
      properties: { sessionID: "ses_lead", status: { type: "busy" } },
    })
    expect(seen).toEqual([{ type: "agent.status", agentId: "lead", status: "busy" }])
    await Bun.sleep(450)
    unsubscribe()
    expect(seen).toEqual([{ type: "agent.status", agentId: "lead", status: "busy" }])
    sync.clearPendingTimers()
  })

  test("ignores tool stream events for portal status", async () => {
    resetAgentSyncForTests()
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    const sync = agentSync("/tmp/portal-agent-sync-test-tools")
    sync.sessionToSpawn.set("ses_root", "track-ai-foundation-root")
    await sync.handleOpencodeEvent({
      type: "session.next.tool.called",
      properties: { sessionID: "ses_root", tool: "rag_knowledge_search" },
    })
    await sync.handleOpencodeEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_root",
        part: { type: "tool", tool: "edit", sessionID: "ses_root" },
      },
    })
    unsubscribe()
    expect(seen).toEqual([])
  })

  test("resolveSnapshotStatus uses HTTP session status when OpenCode is reachable", () => {
    resetAgentSyncForTests()
    const sync = agentSync("/tmp/portal-agent-sync-test-4")
    sync.liveBySpawn.set("track-ai-foundation-root", "busy")
    expect(sync.resolveSnapshotStatus("track-ai-foundation-root", "ses_root", {}, true)).toBe("idle")
  })

  test("resolveSnapshotStatus falls back to live SSE when OpenCode is unreachable", () => {
    resetAgentSyncForTests()
    const sync = agentSync("/tmp/portal-agent-sync-test-5")
    sync.liveBySpawn.set("track-ai-foundation-root", "busy")
    expect(sync.resolveSnapshotStatus("track-ai-foundation-root", "ses_root", {}, false)).toBe("busy")
  })

  test("resolveSnapshotStatus maps HTTP busy status", () => {
    resetAgentSyncForTests()
    const sync = agentSync("/tmp/portal-agent-sync-test-6")
    expect(sync.resolveSnapshotStatus("track-ai-foundation-root", "ses_root", { ses_root: "retry" }, true)).toBe(
      "busy",
    )
  })
})

describe("portal events", () => {
  test("delivers injected events to subscribers", () => {
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    deliverPortalEvent({ type: "ping" })
    unsubscribe()
    expect(seen).toEqual([{ type: "ping" }])
  })

  test("emitPortalEvent delivers in-process when enabled", () => {
    const seen: unknown[] = []
    const unsubscribe = subscribePortalEvents((event) => seen.push(event))
    setPortalInProcessDelivery(true)
    emitPortalEvent({
      type: "agent.chat",
      fromSpawnId: "lead",
      toSpawnId: "architect",
      text: "hello",
    })
    setPortalInProcessDelivery(false)
    unsubscribe()
    expect(seen).toEqual([
      {
        type: "agent.chat",
        fromSpawnId: "lead",
        toSpawnId: "architect",
        text: "hello",
      },
    ])
  })

  test("emitPortalEvent posts to internal portal api across processes", async () => {
    const port = String(18000 + Math.floor(Math.random() * 1000))
    const token = "test-internal-token"
    let posted: unknown
    const server = Bun.serve({
      port: Number(port),
      hostname: "127.0.0.1",
      fetch: async (request) => {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/portal/api/internal/event") {
          return new Response("not found", { status: 404 })
        }
        if (request.headers.get("X-Gatehouse-Portal-Internal-Token") !== token) {
          return new Response("unauthorized", { status: 401 })
        }
        posted = await request.json()
        return Response.json(posted)
      },
    })

    process.env.GATEHOUSE_PORTAL_PORT = port
    process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = token
    setPortalInProcessDelivery(false)
    emitPortalEvent({
      type: "agent.chat",
      fromSpawnId: "lead",
      toSpawnId: "architect",
      text: "hello",
    })
    await Bun.sleep(50)
    server.stop()
    delete process.env.GATEHOUSE_PORTAL_PORT
    delete process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
    expect(posted).toEqual({
      type: "agent.chat",
      fromSpawnId: "lead",
      toSpawnId: "architect",
      text: "hello",
    })
  })
})
