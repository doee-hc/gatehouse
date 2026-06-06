import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { RegistryDatabase } from "../src/registry/db.ts"
import { readManifest, writeManifest } from "../src/tree/store.ts"
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
      path.join(dir, ".gatehouse/architect/trees/m-tree-db/manifest.yaml"),
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
