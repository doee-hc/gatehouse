import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  handleAgentCommand,
  parseAgentCommand,
  syncAgentDeliveryWatermark,
} from "../../src/channels/registry/agent-command.ts"
import { getLastDeliveredAssistantMessageId } from "../../src/channels/store/state.ts"
import type { OpencodeClient } from "../../src/channels/opencode/client.ts"
import type { ChannelBridgeConfig } from "../../src/channels/types.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempBridgeConfig() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cmd-"))
  tempDirs.push(projectDir)
  const gatehouse = path.join(projectDir, ".gatehouse")
  fs.mkdirSync(gatehouse, { recursive: true })
  const db = new Database(path.join(gatehouse, "registry.db"))
  db.exec(`
    CREATE TABLE registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      profile TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      status TEXT NOT NULL
    );
  `)
  db.run(
    `INSERT INTO registry_agent (agent_id, scope, session_id, display_name, profile, status)
     VALUES ('outer:lead', 'outer', 'ses_lead', 'Lead', 'lead', 'active')`,
  )
  db.close()
  const stateDir = path.join(gatehouse, "channels", "weixin")
  fs.mkdirSync(stateDir, { recursive: true })
  const config: ChannelBridgeConfig = {
    projectDir,
    stateDir,
    opencodeUrl: "http://127.0.0.1:0",
    leadReplyTimeoutMs: 60_000,
  }
  return { config, stateDir }
}

function mockClient(messages: unknown[]) {
  return {
    session: {
      messages: async () => ({ data: messages }),
      get: async () => ({ data: { id: "ses_lead" } }),
    },
  } as unknown as OpencodeClient
}

describe("parseAgentCommand", () => {
  test("returns undefined for normal chat", () => {
    expect(parseAgentCommand("hello")).toBeUndefined()
  })

  test("lists when bare /agent", () => {
    expect(parseAgentCommand("/agent")).toEqual({ kind: "list" })
    expect(parseAgentCommand("  /agent  ")).toEqual({ kind: "list" })
  })

  test("switches with agent_id token", () => {
    expect(parseAgentCommand("/agent inner:m-1:root")).toEqual({
      kind: "switch",
      agentId: "inner:m-1:root",
    })
    expect(parseAgentCommand("/agent outer:lead extra")).toEqual({
      kind: "switch",
      agentId: "outer:lead",
    })
  })
})

describe("syncAgentDeliveryWatermark", () => {
  test("marks latest deliverable assistant message as delivered", async () => {
    const { config, stateDir } = tempBridgeConfig()
    const client = mockClient([
      { info: { id: "m1", role: "assistant" }, parts: [{ type: "text", text: "old" }] },
      { info: { id: "m2", role: "assistant" }, parts: [{ type: "text", text: "latest" }] },
    ])
    await syncAgentDeliveryWatermark(client, config, "wx-user", "ses_lead")
    expect(getLastDeliveredAssistantMessageId(stateDir, "wx-user", "ses_lead")).toBe("m2")
  })
})

describe("handleAgentCommand switch", () => {
  test("sets delivery watermark and returns switched session id", async () => {
    const { config, stateDir } = tempBridgeConfig()
    const client = mockClient([
      { info: { id: "m1", role: "assistant" }, parts: [{ type: "text", text: "history" }] },
    ])
    const result = await handleAgentCommand(client, config, "wx-user", {
      kind: "switch",
      agentId: "outer:lead",
    })
    expect(result.text).toContain("Switched to outer:lead")
    expect(result.switchedSessionId).toBe("ses_lead")
    expect(getLastDeliveredAssistantMessageId(stateDir, "wx-user", "ses_lead")).toBe("m1")
  })
})
