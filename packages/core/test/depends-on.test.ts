import { describe, expect, test } from "bun:test"
import {
  deliverableNodeIds,
  extractDependsOnFromStatement,
  hasDeliverableDepends,
  normalizeDependsOn,
  parseDependsOnArrayBody,
  waitNodeIds,
} from "../src/orchestration/engine/depends-on.ts"

describe("dependsOn", () => {
  test("normalizes string and object entries", () => {
    expect(
      normalizeDependsOn([
        "a1",
        { node: "a2", deliverable: true },
        { node: "a3", deliverable: false },
      ]),
    ).toEqual([
      { node: "a1", deliverable: false },
      { node: "a2", deliverable: true },
      { node: "a3", deliverable: false },
    ])
  })

  test("parses dependsOn array body from script source", () => {
    expect(parseDependsOnArrayBody('"a1", { node: "a2", deliverable: true }')).toEqual([
      { node: "a2", deliverable: true },
      { node: "a1", deliverable: false },
    ])
  })

  test("extracts dependsOn from run statement", () => {
    const statement = `await ctx.run("b1", { text: "go", dependsOn: ["a1", { node: "a2", deliverable: true }] })`
    const dependsOn = extractDependsOnFromStatement(statement)
    expect(dependsOn).toEqual([
      { node: "a2", deliverable: true },
      { node: "a1", deliverable: false },
    ])
    expect(waitNodeIds(dependsOn)).toEqual(["a2", "a1"])
    expect(deliverableNodeIds(dependsOn)).toEqual(["a2"])
    expect(hasDeliverableDepends(dependsOn)).toBe(true)
  })
})
