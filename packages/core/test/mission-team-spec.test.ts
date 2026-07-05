import { describe, expect, test } from "bun:test"
import {
  manifestMembers,
  validateMissionTeamSpec,
} from "../src/missions/manifest/team-spec.ts"
import { sampleMissionManifest, sampleMissionTeamSpec } from "./helpers/mission-fixtures.ts"

describe("validateMissionTeamSpec", () => {
  test("accepts valid spec", () => {
    const spec = sampleMissionTeamSpec()
    validateMissionTeamSpec(spec)
    expect(spec.terminal).toBe("root")
  })

  test("rejects deprecated constraints field", () => {
    let message = ""
    try {
      validateMissionTeamSpec({
        mission_id: "demo-mission",
        terminal: "root",
        nodes: {
          root: { description: "任务协调者", constraints: "coord" } as never,
        },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("must not include constraints")
  })

  test("rejects empty description", () => {
    let message = ""
    try {
      validateMissionTeamSpec(
        sampleMissionTeamSpec({
          nodes: { root: { description: "   " } },
        }),
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("description")
  })

  test("rejects missing terminal in nodes", () => {
    let message = ""
    try {
      validateMissionTeamSpec(sampleMissionTeamSpec({ terminal: "missing" }))
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("terminal missing")
  })
})

describe("manifestMembers", () => {
  test("includes description", () => {
    const manifest = sampleMissionManifest({
      mission_id: "demo",
      nodes: {
        root: { session_id: "ses-1", description: "协调", profile: "build" },
        leaf: { session_id: "ses-2", description: "执行", profile: "build" },
      },
    })
    const members = manifestMembers(manifest)
    expect(members.find((item) => item.node_id === "root")?.description).toBe("协调")
    expect(members.find((item) => item.node_id === "leaf")?.description).toBe("执行")
  })
})
