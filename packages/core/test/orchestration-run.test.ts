import { describe, expect, test } from "bun:test"
import { orchestrationParallel } from "../src/orchestration/primitives.ts"
import { orchestrationRun } from "../src/orchestration/run.ts"
import type { NodeBriefPartial, OrchestrationEngine } from "../src/orchestration/types.ts"

function mockEngine() {
  const log: string[] = []
  const engine: OrchestrationEngine = {
    async setBrief(nodeId: string, _partial: NodeBriefPartial) {
      log.push(`brief:${nodeId}`)
    },
    async prompt(nodeId: string, input: { text?: string; reply?: boolean; dependsOn?: unknown[] }) {
      const deps = input.dependsOn?.length ? `:deps=${input.dependsOn.length}` : ""
      log.push(`prompt:${nodeId}:${input.reply !== false ? "reply" : "silent"}:${input.text ?? ""}${deps}`)
    },
    async waitFor(nodeId: string) {
      log.push(`wait:${nodeId}`)
    },
  }
  return { engine, log }
}

const workOrderText = (nodeId: string, supplementary?: string) =>
  supplementary ? `work-order:${nodeId}:${supplementary}` : `work-order:${nodeId}`

describe("run / parallel", () => {
  test("run dispatches brief, prompt, dependsOn, and waits by default", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(
      engine,
      "leaf",
      {
        brief: { your_work: ["work"], acceptance_slice: ["done"] },
        text: "go",
        dependsOn: [{ node: "upstream", deliverable: true }],
      },
      { workOrderText },
    )
    expect(log).toEqual([
      "brief:leaf",
      "prompt:leaf:reply:work-order:leaf:go:deps=1",
      "wait:leaf",
    ])
  })

  test("run with reply:false skips completion wait", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(engine, "leaf", { brief: { your_work: ["w"] }, text: "go", reply: false })
    expect(log).toEqual(["brief:leaf", "prompt:leaf:silent:go"])
  })

  test("run without text uses auto work order when reply is true", async () => {
    const { engine, log } = mockEngine()
    await orchestrationRun(
      engine,
      "leaf",
      { brief: { your_work: ["work"], acceptance_slice: ["done"] } },
      { workOrderText },
    )
    expect(log).toEqual(["brief:leaf", "prompt:leaf:reply:work-order:leaf", "wait:leaf"])
  })

  test("run without brief throws", async () => {
    const { engine } = mockEngine()
    let message = ""
    try {
      await orchestrationRun(engine, "leaf", { text: "go" } as never)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('run requires brief for node "leaf"')
  })

  test("parallel runs tracks concurrently", async () => {
    const order: string[] = []
    const delay = (ms: number, label: string) =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          order.push(label)
          resolve(label)
        }, ms)
      })

    const [a, b] = await orchestrationParallel([
      () => delay(30, "a"),
      () => delay(10, "b"),
    ])

    expect(a).toBe("a")
    expect(b).toBe("b")
    expect(order).toEqual(["b", "a"])
  })
})
