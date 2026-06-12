import { expect, test } from "bun:test"
import { normalizeMissionOverrideFields } from "../src/missions/normalize.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"

test("normalizeMissionOverrideFields keeps explicit fields", () => {
  const result = normalizeMissionOverrideFields({
    notes: "背景",
    user_topology: "solo root",
    user_skill: "docs",
  })
  expect(result).toEqual({
    notes: "背景",
    user_topology: "solo root",
    user_skill: "docs",
  })
})

test("normalizeMissionOverrideFields migrates legacy prefixed notes", () => {
  const result = normalizeMissionOverrideFields({
    notes: [
      "用户背景说明",
      "[用户指定·拓扑] 用户要求 solo",
      "[用户指定·skill] 文档用 docs domain",
    ].join("\n"),
  })
  expect(result).toEqual({
    notes: "用户背景说明",
    user_topology: "用户要求 solo",
    user_skill: "文档用 docs domain",
  })
})

test("parseMissionsFile reads user_topology and user_skill fields", () => {
  const doc = parseMissionsFile(`
schema_version: 3
missions:
  - id: a
    status: queued
    objective: goal
    done_when: ["x"]
    must_not: []
    notes: "背景"
    user_topology: "solo"
    user_skill: "docs"
`)
  expect(doc.missions[0]).toMatchObject({
    id: "a",
    notes: "背景",
    user_topology: "solo",
    user_skill: "docs",
  })
})

test("parseMissionsFile migrates legacy notes prefixes on read", () => {
  const doc = parseMissionsFile(`
missions:
  - id: legacy
    status: queued
    done_when: ["x"]
    must_not: []
    notes: |
      背景
      [user-specified·topology] solo root only
      [user-specified·skill] Use docs
`)
  expect(doc.missions[0]).toMatchObject({
    notes: "背景",
    user_topology: "solo root only",
    user_skill: "Use docs",
  })
})
