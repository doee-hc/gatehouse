import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { aggregateSessionMetrics, mergeSessionMetrics } from "../src/metrics/aggregate.ts"
import {
  classifyMessageKind,
  dumpSessionContext,
  ensureMissionContextDumped,
  formatTimelineMarkdown,
  missionContextAlreadyDumped,
} from "../src/session/context-dump.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import type { MissionManifest } from "../src/missions/manifest/types.ts"

describe("context dump", () => {
  test("classifyMessageKind distinguishes user, gatehouse, summary, compaction", () => {
    expect(
      classifyMessageKind({
        info: { role: "user", id: "u1" },
        parts: [{ type: "text", text: "hello user" }],
      }),
    ).toBe("user")

    expect(
      classifyMessageKind({
        info: { role: "user", id: "u2" },
        parts: [{ type: "text", text: "[Gatehouse 消息 · 来自 lead]\n\nkickoff" }],
      }),
    ).toBe("gatehouse")

    expect(
      classifyMessageKind({
        info: { role: "user", id: "u3" },
        parts: [{ type: "compaction", auto: true, tail_start_id: "tail-1" }],
      }),
    ).toBe("compaction_marker")

    expect(
      classifyMessageKind({
        info: { role: "assistant", id: "a1", summary: true, profile: "compaction" },
        parts: [{ type: "text", text: "## Goal\n- task" }],
      }),
    ).toBe("summary")
  })

  test("formatTimelineMarkdown includes kind tags and tool lines", () => {
    const md = formatTimelineMarkdown({
      missionId: "m1",
      nodeId: "node-a",
      sessionId: "ses_a",
      messages: [
        {
          info: { role: "user", id: "u1", time: { created: 1000 } },
          parts: [{ type: "text", text: "hello" }],
        },
        {
          info: { role: "assistant", id: "a1", time: { created: 2000 }, tokens: { input: 1, output: 2 } },
          parts: [
            {
              type: "tool",
              tool: "gatehouse_send_message",
              state: {
                status: "completed",
                input: { recipient: "node-child", message: "go" },
                output: '{"ok":true}',
                time: { start: 2001, end: 2100 },
              },
            },
          ],
        },
      ],
    })

    expect(md).toContain("kind=user")
    expect(md).toContain("kind=assistant")
    expect(md).toContain("tool=gatehouse_send_message")
    expect(md).toContain("recipient=node-child")
  })

  test("aggregateSessionMetrics and mergeSessionMetrics roll up tokens and tools", () => {
    const sessionA = aggregateSessionMetrics({
      node_id: "node-a",
      session_id: "ses_a",
      duration_ms: 1000,
      messages: [
        {
          info: { role: "assistant", tokens: { input: 10, output: 5 }, cost: 0.01 },
          parts: [
            {
              type: "tool",
              tool: "bash",
              state: { status: "completed" },
            },
          ],
        },
      ],
    })
    expect(sessionA.tokens.input).toBe(10)
    expect(sessionA.tokens.output).toBe(5)
    expect(sessionA.cost).toBe(0.01)
    expect(sessionA.tools.by_name.bash?.completed).toBe(1)

    const sessionB = aggregateSessionMetrics({
      node_id: "node-b",
      session_id: "ses_b",
      duration_ms: 500,
      messages: [
        {
          info: { role: "assistant", tokens: { input: 3, output: 2 }, cost: 0.02 },
          parts: [
            {
              type: "tool",
              tool: "bash",
              state: { status: "error" },
            },
          ],
        },
      ],
    })

    const branch = mergeSessionMetrics([sessionA, sessionB])
    expect(branch.session_count).toBe(2)
    expect(branch.tokens.input).toBe(13)
    expect(branch.cost).toBe(0.03)
    expect(branch.tools.by_name.bash?.total).toBe(2)
    expect(branch.tools.errors).toBe(1)
    expect(branch.sessions).toHaveLength(2)
  })

  test("dumpSessionContext supports custom output directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-context-custom-"))
    try {
      const missionId = "m-custom"
      const relDir = ".gatehouse/internal/debug/sessions/m-custom/outer/lead"
      const client: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async messages() {
            return {
              data: [
                {
                  info: { role: "user", id: "u1", time: { created: 1000 } },
                  parts: [{ type: "text", text: "hello" }],
                },
              ],
            }
          },
          async get() {
            return { data: { created: 1000, updated: 2000 } }
          },
          async promptAsync() {
            return undefined
          },
        },
      }

      const dumped = await dumpSessionContext({
        client,
        projectDirectory: dir,
        missionId,
        nodeId: "lead",
        sessionId: "ses_lead",
        profile: "lead",
        relDir,
        absDir: path.join(dir, relDir),
      })
      expect(dumped.rel_dir).toBe(relDir)
      expect(await Bun.file(path.join(dir, relDir, "messages.json")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("ensureMissionContextDumped skips when index.json already exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-context-skip-"))
    try {
      const missionId = "m-skip"
      const contextRoot = path.join(dir, ".gatehouse/missions", missionId, "context")
      await mkdir(contextRoot, { recursive: true })
      await Bun.write(path.join(contextRoot, "index.json"), JSON.stringify({ mission_id: missionId }))

      expect(missionContextAlreadyDumped(dir, missionId)).toBe(true)

      const manifest: MissionManifest = {
        mission_id: missionId,
        status: "running",
        terminal_node: "root",
        created_at: new Date().toISOString(),
        nodes: {
          terminal: { session_id: "ses_root", display_name: "root", profile: "build" },
        },
      }

      const client: GatehouseClient = {
        session: {
          async create() {
            return { id: "unused" }
          },
          async messages() {
            throw new Error("messages should not run when context already dumped")
          },
          async get() {
            throw new Error("get should not run when context already dumped")
          },
          async promptAsync() {
            return undefined
          },
        },
      }

      const result = await ensureMissionContextDumped({
        client,
        projectDirectory: dir,
        manifest,
      })
      expect(result.skipped).toBe(true)
      expect(result.reason).toBe("already_dumped")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
