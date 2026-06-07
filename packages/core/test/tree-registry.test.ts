import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { RegistryDatabase } from "../src/registry/db.ts"
import { readManifest, readTreesIndex, writeManifest } from "../src/tree/store.ts"
import { stringifyYaml } from "../src/yaml.ts"
import { parseMissionsFile } from "../src/missions/parse.ts"
import { parseYaml } from "../src/yaml.ts"
import type { TreeManifest } from "../src/tree/types.ts"

const sampleManifest = (): TreeManifest => ({
  mission_id: "m-tree-db",
  status: "running",
  root_node: "root",
  created_at: "2026-06-01T00:00:00Z",
  nodes: {
    root: { session_id: "ses-root", parent: null, display_name: "root", profile: "build-coordinator" },
    leaf: { session_id: "ses-leaf", parent: "root", display_name: "leaf", profile: "build", skill_domain: "docs" },
  },
})

test("tree manifest round-trips in registry.db; yaml is export-only", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-tree-registry-"))
  try {
    await writeManifest(dir, sampleManifest())
    const fromDb = new RegistryDatabase(dir, { readonly: true }).getTreeManifest("m-tree-db")
    expect(fromDb?.nodes.leaf?.skill_domain).toBe("docs")
    const fromRead = await readManifest(dir, "m-tree-db")
    expect(fromRead?.root_node).toBe("root")
    const yamlText = await Bun.file(
      path.join(dir, ".gatehouse/internal/exports/trees/m-tree-db/manifest.yaml"),
    ).text()
    expect(yamlText).toContain("m-tree-db")
    new RegistryDatabase(dir).saveTreeManifest({
      ...sampleManifest(),
      status: "archived",
      archived_at: "2026-06-02T00:00:00Z",
    })
    expect(await readManifest(dir, "m-tree-db")).toMatchObject({ status: "archived" })
    expect(yamlText).toContain("running")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("stringifyYaml uses block style for nested mappings", () => {
  const yaml = stringifyYaml({ mission_id: "m1", nodes: { root: { session_id: "ses-1", parent: null } } })
  expect(yaml.includes("mission_id: m1\n")).toBe(true)
  expect(yaml.includes("nodes:\n")).toBe(true)
  expect(yaml.includes("  root:\n")).toBe(true)
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
  expect(() => parseYaml(yaml)).not.toThrow()
  const parsed = parseMissionsFile(yaml)
  expect(parsed.missions[0]?.notes).toBe("line one\nline two\n")
  expect(parsed.missions[0]?.started_at).toBe("2026-06-07T15:28:41.203Z")
})

test("readTreesIndex derives from registry.db", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-trees-index-db-"))
  try {
    await writeManifest(dir, sampleManifest())
    const index = await readTreesIndex(dir)
    expect(index.trees.length).toBe(1)
    expect(index.trees[0]?.mission_id).toBe("m-tree-db")
    expect(index.trees[0]?.root_node).toBe("root")
    expect(index.trees[0]?.root_session_id).toBe("ses-root")
    expect(index.trees[0]?.status).toBe("running")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("findTreeManifestByExecSession queries registry.db", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-tree-registry-"))
  try {
    await writeManifest(dir, sampleManifest())
    const hit = new RegistryDatabase(dir, { readonly: true }).findTreeManifestByExecSession("ses-leaf")
    expect(hit?.missionId).toBe("m-tree-db")
    expect(hit?.manifest.root_node).toBe("root")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
