import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { RegistryDatabase } from "../src/registry/db.ts"
import { readMissionManifest, readMissionManifestIndex, writeMissionManifest, writeExtractManifest, writeVerifyManifest, findMissionBySession } from "../src/missions/manifest/store.ts"
import { stringifyYaml } from "../src/yaml.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { parseYaml } from "../src/yaml.ts"
import type { MissionManifest } from "../src/missions/manifest/types.ts"

const sampleManifest = (): MissionManifest => ({
  mission_id: "m-tree-db",
  status: "running",
  terminal_node: "terminal",
  created_at: "2026-06-01T00:00:00Z",
  nodes: {
    terminal: { session_id: "ses-root", display_name: "root", profile: "build" },
    leaf: { session_id: "ses-leaf", display_name: "leaf", profile: "build", skill_domain: "docs" },
  },
})

test("tree manifest round-trips in registry.db; yaml is export-only", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-tree-registry-"))
  try {
    await writeMissionManifest(dir, sampleManifest())
    const fromDb = new RegistryDatabase(dir, { readonly: true }).getMissionManifest("m-tree-db")
    expect(fromDb?.nodes.leaf?.skill_domain).toBe("docs")
    const fromRead = await readMissionManifest(dir, "m-tree-db")
    expect(fromRead?.terminal_node).toBe("terminal")
    const yamlText = await Bun.file(
      path.join(dir, ".gatehouse/internal/exports/missions/m-tree-db/manifest.yaml"),
    ).text()
    expect(yamlText).toContain("m-tree-db")
    new RegistryDatabase(dir).saveMissionManifest({
      ...sampleManifest(),
      status: "archived",
      archived_at: "2026-06-02T00:00:00Z",
    })
    expect(await readMissionManifest(dir, "m-tree-db")).toMatchObject({ status: "archived" })
    expect(yamlText).toContain("running")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("stringifyYaml uses block style for nested mappings", () => {
  const yaml = stringifyYaml({ mission_id: "m1", nodes: { terminal: { session_id: "ses-1"} } })
  expect(yaml.includes("mission_id: m1\n")).toBe(true)
  expect(yaml.includes("nodes:\n")).toBe(true)
  expect(yaml.includes("  terminal:\n")).toBe(true)
  expect(yaml.includes("nodes: {")).toBe(false)
})

test("stringifyYaml preserves multiline notes in mission arrays", () => {
  const doc = {
    schema_version: 2,
    missions: [
      {
        id: "chat-32-concurrent",
        status: "running",
        done_when: ["item1"],
        must_not: ["item2"],
        notes: "line one\nline two\n",
        started_at: "2026-06-07T15:28:41.203Z",
      },
    ],
  }
  const yaml = stringifyYaml(doc)
  parseYaml(yaml)
  const parsed = parseMissionsFile(yaml)
  expect(parsed.missions[0]?.notes).toBe("line one\nline two")
  expect(parsed.missions[0]?.started_at).toBe("2026-06-07T15:28:41.203Z")
})

test("readMissionManifestIndex derives from registry.db", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-trees-index-db-"))
  try {
    await writeMissionManifest(dir, sampleManifest())
    const index = await readMissionManifestIndex(dir)
    expect(index.missions.length).toBe(1)
    expect(index.missions[0]?.mission_id).toBe("m-tree-db")
    expect(index.missions[0]?.terminal_node).toBe("terminal")
    expect(index.missions[0]?.terminal_session_id).toBe("ses-root")
    expect(index.missions[0]?.status).toBe("running")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("findMissionManifestByExecSession queries registry.db", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-tree-registry-"))
  try {
    await writeMissionManifest(dir, sampleManifest())
    const hit = new RegistryDatabase(dir, { readonly: true }).findMissionManifestByExecSession("ses-leaf")
    expect(hit?.missionId).toBe("m-tree-db")
    expect(hit?.manifest.terminal_node).toBe("terminal")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("findMissionBySession resolves extract and verify sessions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-tree-session-lookup-"))
  try {
    await writeMissionManifest(dir, sampleManifest())
    await writeExtractManifest(dir, {
      mission_id: "m-tree-db",
      created_at: "2026-06-01T00:00:00Z",
      extract_order: ["leaf"],
      nodes: {
        leaf: {
          exec_session_id: "ses-leaf",
          extract_session_id: "ses-extract-leaf",
          skill_domain: "docs",
        },
      },
    })
    await writeVerifyManifest(dir, {
      mission_id: "m-tree-db",
      created_at: "2026-06-02T00:00:00Z",
      verify_order: ["leaf"],
      nodes: {
        leaf: {
          extract_session_id: "ses-extract-leaf",
          verify_session_id: "ses-verify-leaf",
          skill_domain: "docs",
        },
      },
    })
    const readonlyDb = () => new RegistryDatabase(dir, { readonly: true })
    expect(readonlyDb().findMissionManifestByExtractSession("ses-extract-leaf")?.missionId).toBe("m-tree-db")
    expect(readonlyDb().findMissionManifestByVerifySession("ses-verify-leaf")?.missionId).toBe("m-tree-db")
    expect((await findMissionBySession(dir, "ses-extract-leaf"))?.missionId).toBe("m-tree-db")
    expect((await findMissionBySession(dir, "ses-verify-leaf"))?.missionId).toBe("m-tree-db")
    expect(await findMissionBySession(dir, "ses-missing")).toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
