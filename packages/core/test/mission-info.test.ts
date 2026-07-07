import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { resolveMissionInfo, resolveMissionInfoRoleView } from "../src/missions/info.ts"
import type { RegistryAgent } from "../src/registry/types.ts"
import { saveMissionScriptRecord } from "../src/orchestration/lifecycle/coordinator.ts"

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
  test("maps outer profiles and infers inner views from topology", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-info-"))
    try {
      await mkdir(path.join(dir, ".gatehouse"), { recursive: true })
      saveMissionScriptRecord(dir, {
        team: {
          mission_id: "m1",
          terminal: "node-root",
          nodes: {
            "node-root": { description: "root" },
            "node-leaf": { description: "leaf" },
          },
        },
      })

      expect(await resolveMissionInfoRoleView(dir, agent({ scope: "outer", profile: "lead" }))).toBe("lead")
      expect(await resolveMissionInfoRoleView(dir, agent({ scope: "outer", profile: "architect" }))).toBe(
        "architect",
      )
      expect(await resolveMissionInfoRoleView(dir, agent({ scope: "outer", profile: "curator" }))).toBe("curator")
      expect(await resolveMissionInfoRoleView(dir, agent({ scope: "outer", profile: "arbiter" }))).toBe("forbidden")
      expect(
        await resolveMissionInfoRoleView(
          dir,
          agent({ scope: "inner", profile: "build", missionId: "m1", nodeId: "node-leaf" }),
        ),
      ).toBe("execution")
      expect(
        await resolveMissionInfoRoleView(
          dir,
          agent({ scope: "inner", profile: "build", missionId: "m1", nodeId: "node-root" }),
        ),
      ).toBe("execution")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
