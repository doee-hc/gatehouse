import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { RegistryStore } from "../src/registry/store.ts"
import { loadGatehouseSidebarState, loadGatehouseSidebarStateSync, missionManifestLines } from "../src/tui/data.ts"
import type { GatehouseClient } from "../src/session/client.ts"
import { sampleMissionManifest } from "./helpers/mission-fixtures.ts"
import { stringifyYaml } from "../src/yaml.ts"

function mockClient(): GatehouseClient {
  return {
    session: {
      async create() {
        return { id: "ses_unused" }
      },
      async promptAsync() {},
      async messages() {
        return { data: [] }
      },
      async get() {
        return { data: {} }
      },
      async status() {
        return { data: {} }
      },
    },
  }
}

describe("gatehouse tui data", () => {
  test("missionManifestLines renders nested nodes", () => {
    const manifest = sampleMissionManifest({
      mission_id: "demo",
      terminal_node: "root",
      nodes: {
        root: { session_id: "ses_root", display_name: "任务协调者", profile: "build" },
        leaf: { session_id: "ses_leaf", display_name: "执行成员", profile: "build" },
      },
    })
    expect(missionManifestLines(manifest)).toEqual(["root · 任务协调者", "leaf · 执行成员"])
  })

  test("loadGatehouseSidebarState reads outer agents and session owner", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-tui-data-"))
    try {
      const store = await RegistryStore.create({ directory: dir, client: mockClient() })
      store.registerOuterSession({
        profile: "lead",
        sessionId: "ses_lead",
        projectRootSessionId: "ses_lead",
      })
      store.registerOuterSession({
        profile: "architect",
        sessionId: "ses_architect",
        projectRootSessionId: "ses_lead",
      })

      const state = await loadGatehouseSidebarState(dir, "ses_architect")
      expect(state?.sessionOwner?.profile).toBe("architect")
      expect(state?.outerAgents.some((agent) => agent.profile === "architect")).toBe(true)
      expect(state?.outerAgents.some((agent) => agent.profile === "lead")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadGatehouseSidebarStateSync reads mission status from missions.yaml", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-tui-data-"))
    try {
      await RegistryStore.create({ directory: dir, client: mockClient() })
      await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
      await writeFile(
        path.join(dir, ".gatehouse", "lead", "missions.yaml"),
        stringifyYaml({
          schema_version: 2,
          missions: [
            { id: "m-done", status: "done", objective: "finished", done_when: [], must_not: [] },
          ],
        }),
      )

      const state = loadGatehouseSidebarStateSync(dir)
      expect(state?.missions).toEqual([{ missionId: "m-done", status: "done", objective: "finished" }])
      expect(state?.teams).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
