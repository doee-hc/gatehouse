import { describe, expect, test } from "bun:test"
import { orchestrationParallel, orchestrationPipeline } from "../src/orchestration/engine/primitives.ts"

describe("orchestrationPipeline", () => {
  test("runs single stage per item in parallel", async () => {
    const order: number[] = []
    const results = await orchestrationPipeline(["a", "b", "c"], async (item) => {
      order.push(item.charCodeAt(0))
      return item.toUpperCase()
    })
    expect(results).toEqual(["A", "B", "C"])
    expect(order).toHaveLength(3)
  })

  test("streams items through multiple stages without cross-item barrier", async () => {
    const results = await orchestrationPipeline(
      [1, 2],
      async (item) => item * 10,
      async (prev, item) => prev + item,
    )
    expect(results).toEqual([11, 22])
  })

  test("failed stage resolves item to null", async () => {
    const results = await orchestrationPipeline(["ok", "fail"], async (item) => {
      if (item === "fail") throw new Error("boom")
      return item
    })
    expect(results).toEqual(["ok", null])
  })

  test("empty items returns empty array", async () => {
    expect(await orchestrationPipeline([], async (item) => item)).toEqual([])
  })
})

describe("orchestrationParallel", () => {
  test("waits for all tracks", async () => {
    const results = await orchestrationParallel([
      async () => 1,
      async () => 2,
    ])
    expect(results).toEqual([1, 2])
  })
})
