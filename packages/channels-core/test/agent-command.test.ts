import { describe, expect, test } from "bun:test"
import { parseAgentCommand } from "../src/registry/agent-command.ts"

describe("parseAgentCommand", () => {
  test("returns undefined for normal chat", () => {
    expect(parseAgentCommand("hello")).toBeUndefined()
  })

  test("lists when bare /agent", () => {
    expect(parseAgentCommand("/agent")).toEqual({ kind: "list" })
    expect(parseAgentCommand("  /agent  ")).toEqual({ kind: "list" })
  })

  test("switches with agent_id token", () => {
    expect(parseAgentCommand("/agent inner:m-1:root")).toEqual({
      kind: "switch",
      agentId: "inner:m-1:root",
    })
    expect(parseAgentCommand("/agent outer:lead extra")).toEqual({
      kind: "switch",
      agentId: "outer:lead",
    })
  })
})
