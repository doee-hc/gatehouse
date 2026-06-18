import { test, expect } from "bun:test"
import { spawnIdForAgent } from "../src/portal/spawn-id.ts"

test("spawnIdForAgent maps outer profiles to portal boss seat ids", () => {
  expect(
    spawnIdForAgent({
      scope: "outer",
      profile: "lead",
      nodeId: undefined,
      agentId: "outer:lead",
    }),
  ).toBe("lead")
  expect(
    spawnIdForAgent({
      scope: "outer",
      profile: "architect",
      nodeId: undefined,
      agentId: "outer:architect",
    }),
  ).toBe("architect")
  expect(
    spawnIdForAgent({
      scope: "outer",
      profile: "curator",
      nodeId: undefined,
      agentId: "outer:curator",
    }),
  ).toBe("curator")
  expect(
    spawnIdForAgent({
      scope: "outer",
      profile: "arbiter",
      nodeId: undefined,
      agentId: "outer:arbiter",
    }),
  ).toBe("arbiter")
})

test("spawnIdForAgent maps retro analyst to portal seat id", () => {
  expect(
    spawnIdForAgent({
      scope: "retro",
      profile: "retro-analyst",
      nodeId: undefined,
      agentId: "retro:m-a",
    }),
  ).toBe("retro-analyst")
})
