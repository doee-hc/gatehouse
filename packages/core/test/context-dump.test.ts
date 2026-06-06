import { describe, expect, test } from "bun:test"
import { aggregateSessionMetrics, mergeSessionMetrics } from "../src/metrics/aggregate.ts"
import { classifyMessageKind, formatTimelineMarkdown } from "../src/session/context-dump.ts"

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

    const subtree = mergeSessionMetrics([sessionA, sessionB])
    expect(subtree.session_count).toBe(2)
    expect(subtree.tokens.input).toBe(13)
    expect(subtree.cost).toBe(0.03)
    expect(subtree.tools.by_name.bash?.total).toBe(2)
    expect(subtree.tools.errors).toBe(1)
    expect(subtree.sessions).toHaveLength(2)
  })
})
