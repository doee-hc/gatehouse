import { describe, expect, test } from "bun:test"
import {
  extractDependsOnFromStatement,
  normalizeDependsOn,
  parseDependsOnArrayBody,
  summaryNodeIds,
  waitNodeIds,
} from "../src/orchestration/depends-on.ts"

describe("dependsOn", () => {
  test("normalizes string and object entries", () => {
    expect(
      normalizeDependsOn(["a1", { node: "a2", summary: true }, { node: "a3", summary: false }]),
    ).toEqual([
      { node: "a1", summary: false },
      { node: "a2", summary: true },
      { node: "a3", summary: false },
    ])
  })

  test("parses dependsOn array body from script source", () => {
    expect(parseDependsOnArrayBody('"a1", { node: "a2", summary: true }')).toEqual([
      { node: "a2", summary: true },
      { node: "a1", summary: false },
    ])
  })

  test("extracts dependsOn from run statement", () => {
    const statement = `await ctx.run("b1", { text: "go", dependsOn: ["a1", { node: "a2", summary: true }] })`
    expect(extractDependsOnFromStatement(statement)).toEqual([
      { node: "a2", summary: true },
      { node: "a1", summary: false },
    ])
    expect(waitNodeIds(extractDependsOnFromStatement(statement))).toEqual(["a2", "a1"])
    expect(summaryNodeIds(extractDependsOnFromStatement(statement))).toEqual(["a2"])
  })
})
