import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { exportPortalCollision, officeLayoutAssetsDir, renderPortalSceneBg } from "../src/portal/office-layout-gen/index.ts"
import { generateOfficeLayout } from "../src/portal/office-layout-generate.ts"

const GOLDEN_COLLISION = {
  chairs: [
    { kind: "front", x: 128, y: 416, facing: "up", deskSortDepth: 448 },
    { kind: "back", x: 128, y: 320, facing: "down", deskSortDepth: 448 },
    { kind: "front", x: 224, y: 416, facing: "up", deskSortDepth: 448 },
    { kind: "back", x: 224, y: 320, facing: "down", deskSortDepth: 448 },
    { kind: "front", x: 320, y: 416, facing: "up", deskSortDepth: 448 },
    { kind: "back", x: 320, y: 320, facing: "down", deskSortDepth: 448 },
    { kind: "front", x: 416, y: 416, facing: "up", deskSortDepth: 448 },
    { kind: "back", x: 416, y: 320, facing: "down", deskSortDepth: 448 },
    { kind: "front", x: 512, y: 416, facing: "up", deskSortDepth: 448 },
    { kind: "back", x: 512, y: 320, facing: "down", deskSortDepth: 448 },
  ],
  decorCount: 16,
  blockedCount: 249,
} as const

describe("office-layout-gen (TypeScript)", () => {
  test("assets resolve from bundled package path", async () => {
    expect(await Bun.file(path.join(officeLayoutAssetsDir(), "full_office.json")).exists()).toBe(true)
  })

  test("exportPortalCollision is deterministic for seed 42 / 5 workstations", async () => {
    const assetsDir = officeLayoutAssetsDir()
    const first = await exportPortalCollision(assetsDir, { workstation_count: 5, seed: 42 })
    const second = await exportPortalCollision(assetsDir, { workstation_count: 5, seed: 42 })
    expect(second).toEqual(first)
    expect(first.chairs).toEqual(GOLDEN_COLLISION.chairs)
    expect(first.decor).toHaveLength(GOLDEN_COLLISION.decorCount)
    expect(first.blocked.flat().filter(Boolean)).toHaveLength(GOLDEN_COLLISION.blockedCount)
    expect(first.chairs.filter((chair) => chair.kind === "front")).toHaveLength(5)
  })

  test("renderPortalSceneBg writes a PNG", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-office-layout-gen-"))
    const outputPath = path.join(dir, "scene-bg.png")
    await renderPortalSceneBg(officeLayoutAssetsDir(), {
      workstation_count: 3,
      seed: 7,
      outputPath,
    })
    const file = Bun.file(outputPath)
    expect(await file.exists()).toBe(true)
    expect(file.size > 1000).toBe(true)
    const header = new Uint8Array(await file.arrayBuffer())
    expect(header[0]).toBe(137)
    expect(String.fromCharCode(header[1]!, header[2]!, header[3]!, header[4]!)).toBe("PNG\r")
  })

  test("generateOfficeLayout produces portal office assets without python", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "gh-office-layout-portal-"))
    const spec = {
      schema_version: 1 as const,
      revision: "ws:2",
      seed: "test-seed",
      workstation_count: 2,
      inner_nodes: [],
      bindings: [],
      updated_at: new Date().toISOString(),
    }
    const generated = await generateOfficeLayout(projectDir, spec)
    expect(generated.warnings.join(" ")).not.toContain("python3")
    expect(await Bun.file(path.join(generated.officeDir, "scene-bg.png")).exists()).toBe(true)
    expect(await Bun.file(path.join(generated.officeDir, "map.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(generated.officeDir, "manifest.json")).exists()).toBe(true)
    const map = (await Bun.file(path.join(generated.officeDir, "map.json")).json()) as {
      layers: { name: string; objects?: unknown[] }[]
    }
    const furniture = map.layers.find((layer) => layer.name === "furniture")
    expect(Array.isArray(furniture?.objects)).toBe(true)
  })

  test("exportPortalCollision uses baked preset for 16 workstations quickly", async () => {
    const assetsDir = officeLayoutAssetsDir()
    const { officeLayoutPresetAvailable } = await import("../src/portal/office-layout-gen/preset-layouts.ts")
    if (!officeLayoutPresetAvailable(16)) return
    const { layoutSeed, layoutSeedInt } = await import("../src/portal/office-layout.ts")
    const seed = layoutSeedInt(layoutSeed("ws:16"))
    const t0 = performance.now()
    const result = await exportPortalCollision(assetsDir, { workstation_count: 16, seed })
    const elapsed = performance.now() - t0
    expect(elapsed < 500).toBe(true)
    expect(result.chairs.length > 0).toBe(true)
    expect(result.decor.length > 0).toBe(true)
  })

  test("exportPortalCollision uses ws:16 preset when workstation_count exceeds cap", async () => {
    const assetsDir = officeLayoutAssetsDir()
    const { officeLayoutPresetAvailable } = await import("../src/portal/office-layout-gen/preset-layouts.ts")
    if (!officeLayoutPresetAvailable(16)) return
    const { layoutSeed, layoutSeedInt } = await import("../src/portal/office-layout.ts")
    const seed = layoutSeedInt(layoutSeed("ws:16"))
    const capped = await exportPortalCollision(assetsDir, { workstation_count: 20, seed })
    const direct = await exportPortalCollision(assetsDir, { workstation_count: 16, seed })
    expect(capped).toEqual(direct)
  })
})
