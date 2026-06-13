import { describe, expect, test } from "bun:test"
import { resolveMissionInfo, resolveMissionInfoRoleView } from "../src/missions/info.ts"
import type { RegistryAgent } from "../src/registry/types.ts"

function agent(partial: Partial<RegistryAgent> & Pick<RegistryAgent, "scope" | "profile">): RegistryAgent {
  return {
    agentId: "agent",
    sessionId: "ses",
    displayName: "Agent",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("resolveMissionInfoRoleView", () => {
  test("maps outer and inner profiles", () => {
    expect(resolveMissionInfoRoleView(agent({ scope: "outer", profile: "lead" }))).toBe("lead")
    expect(resolveMissionInfoRoleView(agent({ scope: "outer", profile: "architect" }))).toBe("architect")
    expect(resolveMissionInfoRoleView(agent({ scope: "outer", profile: "curator" }))).toBe("curator")
    expect(resolveMissionInfoRoleView(agent({ scope: "outer", profile: "arbiter" }))).toBe("forbidden")
    expect(
      resolveMissionInfoRoleView(
        agent({ scope: "inner", profile: "build", missionId: "m1", nodeId: "node-a" }),
      ),
    ).toBe("execution")
    expect(
      resolveMissionInfoRoleView(
        agent({ scope: "inner", profile: "build-root", missionId: "m1", nodeId: "node-root" }),
      ),
    ).toBe("coordinator")
  })
})

describe("resolveMissionInfo", () => {
  test("rejects arbiter", async () => {
    const result = await resolveMissionInfo({
      projectDirectory: "/tmp",
      sender: agent({ scope: "outer", profile: "arbiter" }),
      missionId: "m1",
    })
    expect(result).toEqual({ error: "NOT_AUTHORIZED" })
  })
})
