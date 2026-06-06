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

test("spawnIdForAgent uses retro- prefix for fork agents", () => {
  expect(
    spawnIdForAgent({
      scope: "retro",
      profile: "root",
      nodeId: "root",
      agentId: "retro:m-a:root",
    }),
  ).toBe("retro-root")
})
