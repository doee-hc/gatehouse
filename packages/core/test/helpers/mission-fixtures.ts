import type { MissionManifest, MissionTeamSpec } from "../../src/missions/manifest/types.ts"

export const sampleMissionTeamSpecYaml = `
mission_id: m-sample
terminal: root
nodes:
  root:
    description: Terminal coordinator
  worker-a:
    description: Worker A
`

export function sampleMissionTeamSpec(overrides?: Partial<MissionTeamSpec>): MissionTeamSpec {
  return {
    mission_id: "m-sample",
    terminal: "root",
    nodes: {
      root: { description: "Terminal coordinator" },
      "worker-a": { description: "Worker A" },
    },
    ...overrides,
  }
}

export function sampleMissionManifest(overrides?: Partial<MissionManifest>): MissionManifest {
  return {
    mission_id: "m-sample",
    status: "running",
    terminal_node: "root",
    created_at: "2026-01-01T00:00:00.000Z",
    nodes: {
      root: {
        session_id: "ses-root",
        display_name: "root",
        description: "Terminal coordinator",
        profile: "build",
      },
      "worker-a": {
        session_id: "ses-a",
        display_name: "worker-a",
        description: "Worker A",
        profile: "build",
      },
    },
    ...overrides,
  }
}
