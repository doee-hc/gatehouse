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

test("normalizeMissionOverrideFields trims empty override fields", () => {
  const result = normalizeMissionOverrideFields({
    notes: "  ",
    user_topology: " solo ",
    user_skill: "",
  })
  expect(result).toEqual({
    user_topology: "solo",
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
