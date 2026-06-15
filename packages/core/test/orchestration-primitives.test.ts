import { describe, expect, test } from "bun:test"
import { orchestrationParallel, orchestrationPipeline } from "../src/orchestration/primitives.ts"

describe("orchestration primitives", () => {
  test("parallel runs thunks concurrently", async () => {
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

  test("pipeline streams items through stages independently", async () => {
    const stageLog: string[] = []
    const results = await orchestrationPipeline(
      ["a", "b"],
      async (nodeId: unknown) => {
        stageLog.push(`prompt:${nodeId}`)
        return nodeId
      },
      async (nodeId: unknown) => {
        stageLog.push(`wait:${nodeId}`)
        return `done:${nodeId}`
      },
    )

    expect(results).toEqual(["done:a", "done:b"])
    expect(stageLog).toEqual(["prompt:a", "prompt:b", "wait:a", "wait:b"])
  })
})
