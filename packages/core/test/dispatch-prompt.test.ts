import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { formatExecutionTeamSnapshotFromManifest } from "../src/dispatch/team-snapshot.ts"
import { readActiveMissionContract as readMissionBrief } from "../src/missions/contract.ts"
import { bulletList } from "../src/missions/parse.ts"
import { loadDispatchRootPrompt } from "../src/dispatch/prompt.ts"
import { loadWatchdogRootWakePrompt } from "../src/watchdog/prompt.ts"
import { parseTreeManifest } from "../src/tree/parse.ts"
import { copyExampleMission } from "./copy-example-mission.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

const multiManifestYaml = `
mission_id: core-example-smoke-v1
status: running
root_node: node-root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  node-root:
    session_id: ses-root
    parent: null
    description: 任务协调者
  node-doc:
    session_id: ses-doc
    parent: node-root
    description: 文档执行成员
`

describe("dispatch prompt", () => {
  test("readMissionBrief reads active registry snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-mission-contract-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const brief = await readMissionBrief(dir, "core-example-smoke-v1")
      expect(brief?.objective).toContain("packages/core")
      expect((brief?.done_when.length ?? 0) > 0).toBe(true)
      expect((brief?.must_not.length ?? 0) > 0).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("formatExecutionTeamSnapshotFromManifest lists nodes in tree order", () => {
    const manifest = parseTreeManifest(multiManifestYaml)
    const snapshot = formatExecutionTeamSnapshotFromManifest(manifest, "zh")
    expect(snapshot).toContain("node-root")
    expect(snapshot).toContain("node-doc")
    expect(snapshot).toContain("任务协调者")
    expect(snapshot).toContain("文档执行成员")
    const memberLines = snapshot.split("\n").filter((line) => line.startsWith("- **node-"))
    expect(memberLines[0]).toContain("node-root")
    expect(memberLines[1]).toContain("node-doc")
  })

  test("loadDispatchRootPrompt renders multi-team template placeholders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-dispatch-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const multiManifest = parseTreeManifest(multiManifestYaml)
      const prompt = await loadDispatchRootPrompt(dir, "core-example-smoke-v1", { manifest: multiManifest })
      expect(prompt).toContain("core-example-smoke-v1")
      expect(prompt).toContain("packages/core")
      expect(prompt).not.toContain("{{mission_id}}")
      expect(prompt).not.toContain("{{objective}}")
      expect(prompt).not.toContain("{{team_execution_snapshot}}")
      expect(prompt).toContain("任务协调者")
      expect(prompt).toContain("node-doc")
      expect(prompt).toContain("执行团队（启动快照）")
      expect(prompt).not.toContain("gatehouse_list_team")
      expect(prompt).not.toContain("结构有变")
      expect(prompt).not.toContain("调用 `gatehouse_list_team()` 了解")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadDispatchRootPrompt uses solo template for single-node manifest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-dispatch-solo-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)
      const soloManifest = parseTreeManifest(`
mission_id: core-example-smoke-v1
status: running
root_node: node-root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  node-root:
    session_id: ses-root
    parent: null
`)
      const prompt = await loadDispatchRootPrompt(dir, "core-example-smoke-v1", { manifest: soloManifest })
      expect(prompt).toContain("唯一执行者")
      expect(prompt).not.toContain("gatehouse_list_team")
      expect(prompt).not.toContain("启动快照")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("loadWatchdogRootWakePrompt uses solo template for single-node manifest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-watchdog-prompt-solo-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const soloManifest = parseTreeManifest(`
mission_id: solo-mission
status: running
root_node: root
created_at: "2026-01-01T00:00:00.000Z"
nodes:
  root:
    session_id: ses-root
    parent: null
`)
      const prompt = await loadWatchdogRootWakePrompt(dir, "solo-mission", 12, soloManifest)
      expect(prompt).toContain("单人执行")
      expect(prompt).not.toContain("gatehouse_list_team")
      expect(prompt).toContain("12")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bulletList shows placeholder for empty list", () => {
    expect(bulletList([])).toBe("（无）")
    expect(bulletList(["a", "b"])).toBe("- a\n- b")
  })
})
