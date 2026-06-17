import { describe, expect, test } from "bun:test"
import { orchestrationFork, orchestrationJoin, orchestrationRun } from "../src/orchestration/run-join-fork.ts"
import type { NodeBriefPartial, OrchestrationEngine } from "../src/orchestration/types.ts"

function mockEngine() {
  const log: string[] = []
  const engine: OrchestrationEngine = {
    async setBrief(nodeId: string, _partial: NodeBriefPartial) {
      log.push(`brief:${nodeId}`)
    },
    async prompt(nodeId: string, input: { text?: string; reply?: boolean }) {
      log.push(`prompt:${nodeId}:${input.reply !== false ? "reply" : "silent"}:${input.text ?? ""}`)
    },
    async waitFor(nodeId: string) {
      log.push(`wait:${nodeId}`)
    },
  }
  return { engine, log }
}

describe("run / join / fork", () => {
  test("run single node dispatches brief, prompt, and waits by default", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(engine, "leaf", {
      brief: { your_work: ["work"], acceptance_slice: ["done"] },
      text: "go",
    })
    expect(log).toEqual(["brief:leaf", "prompt:leaf:reply:go", "wait:leaf"])
  })

  test("run array fan-out dispatches all nodes before waiting", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(engine, ["a", "b"], {
      brief: (id) => ({ your_work: [id], acceptance_slice: ["done"] }),
      text: (id) => `go:${id}`,
    })
    expect(log).toEqual([
      "brief:a",
      "brief:b",
      "prompt:a:reply:go:a",
      "prompt:b:reply:go:b",
      "wait:a",
      "wait:b",
    ])
  })

  test("run with wait:false skips join", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(engine, "leaf", { brief: { your_work: ["w"] }, text: "go", wait: false })
    expect(log).toEqual(["brief:leaf", "prompt:leaf:reply:go"])
  })

  test("run without text uses defaultWorkOrder when reply is true", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(
      engine,
      "leaf",
      { brief: { your_work: ["work"], acceptance_slice: ["done"] } },
      { defaultWorkOrder: (nodeId) => `work-order:${nodeId}` },
    )
    expect(log).toEqual(["brief:leaf", "prompt:leaf:reply:work-order:leaf", "wait:leaf"])
  })

  test("join waits multiple nodes in parallel order", async () => {
    const { engine, log } = mockEngine()
    await orchestrationJoin(engine, ["a", "b"])
    expect(log).toEqual(["wait:a", "wait:b"])
  })

  test("fork runs tracks concurrently", async () => {
    const order: string[] = []
    const delay = (ms: number, label: string) =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          order.push(label)
          resolve(label)
        }, ms)
      })

    const [a, b] = await orchestrationFork([
      () => delay(30, "a"),
      () => delay(10, "b"),
    ])

    expect(a).toBe("a")
    expect(b).toBe("b")
    expect(order).toEqual(["b", "a"])
  })
})
