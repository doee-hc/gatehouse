import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  chairAgentSitWorld,
  innerAgentSitWorld,
  chairSitTileOffsetY,
  capOfficeWorkstationCount,
  computeOfficeLayoutSpec,
  layoutRevisionFromWorkstationCount,
  MAX_OFFICE_WORKSTATION_COUNT,
  syncWorkstationBindings,
  writeOfficeLayoutSpec,
  workstationCountForAgents,
} from "../src/portal/office-layout.ts"
import { stringifyYaml } from "../src/yaml.ts"

describe("office layout spec", () => {
  test("inner chair sit offsets match boss room nudge", () => {
    expect(chairSitTileOffsetY("down")).toBe(0.25)
    expect(chairSitTileOffsetY("up")).toBe(0.75)
    expect(chairAgentSitWorld(0, 0, "down", 32)).toEqual({ x: 16, y: 56 })
    expect(chairAgentSitWorld(0, 0, "up", 32)).toEqual({ x: 16, y: 36 })
    expect(innerAgentSitWorld(0, 0, "down", 32)).toEqual({ x: 16, y: 52 })
    expect(innerAgentSitWorld(0, 0, "up", 32)).toEqual({ x: 16, y: 32 })
  })

  test("workstationCountForAgents pairs two agents per desk", () => {
    expect(workstationCountForAgents(0)).toBe(0)
    expect(workstationCountForAgents(1)).toBe(1)
    expect(workstationCountForAgents(2)).toBe(1)
    expect(workstationCountForAgents(5)).toBe(3)
    expect(workstationCountForAgents(33)).toBe(MAX_OFFICE_WORKSTATION_COUNT)
    expect(capOfficeWorkstationCount(20)).toBe(MAX_OFFICE_WORKSTATION_COUNT)
  })

  test("syncWorkstationBindings stops at 32 slots when map has 16 workstations", () => {
    const nodes = Array.from({ length: 40 }, (_, index) => ({
      mission_id: "m-a",
      node_id: `node-${index}`,
      spawn_id: `node-${index}`,
    }))
    const bindings = syncWorkstationBindings(nodes, undefined, MAX_OFFICE_WORKSTATION_COUNT)
    expect(bindings).toHaveLength(MAX_OFFICE_WORKSTATION_COUNT * 2)
  })

  test("revision only tracks workstation capacity", () => {
    expect(layoutRevisionFromWorkstationCount(0)).toBe("ws:0")
    expect(layoutRevisionFromWorkstationCount(3)).toBe("ws:3")
  })

  test("syncWorkstationBindings keeps slots for active agents and frees finished ones", () => {
    const nodes = [
      { mission_id: "m-a", node_id: "terminal", spawn_id: "terminal" },
      { mission_id: "m-a", node_id: "leaf", spawn_id: "leaf" },
    ]
    const first = syncWorkstationBindings(nodes, undefined, 2)
    expect(first).toEqual([
      { spawn_id: "terminal", slot: 0 },
      { spawn_id: "leaf", slot: 1 },
    ])

    const afterDone = syncWorkstationBindings(
      [{ mission_id: "m-b", node_id: "qa", spawn_id: "qa" }],
      first,
      2,
    )
    expect(afterDone).toEqual([{ spawn_id: "qa", slot: 0 }])
  })

  test("counts inner nodes for the active running mission only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-office-layout-"))
    await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse", "trees", "mission-a"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse", "trees", "mission-b"), { recursive: true })

    await writeFile(
      path.join(dir, ".gatehouse", "lead", "missions.yaml"),
      stringifyYaml({
        schema_version: 2,
        missions: [
          { id: "mission-a", status: "running", started_at: "2026-05-30T10:00:00Z" },
          { id: "mission-b", status: "running", started_at: "2026-05-31T10:00:00Z" },
          { id: "mission-done", status: "done" },
        ],
      }),
    )

    await writeFile(
      path.join(dir, ".gatehouse", "trees", "mission-a", "manifest.yaml"),
      stringifyYaml({
        mission_id: "mission-a",
        status: "running",
        terminal_node: "terminal",
        created_at: "2026-06-01T00:00:00Z",
        nodes: {
          terminal: { session_id: "s-root-a", display_name: "terminal", profile: "build" },
          leaf: { session_id: "s-leaf-a", display_name: "leaf", profile: "build" },
        },
      }),
    )

    await writeFile(
      path.join(dir, ".gatehouse", "trees", "mission-b", "manifest.yaml"),
      stringifyYaml({
        mission_id: "mission-b",
        status: "running",
        terminal_node: "terminal",
        created_at: "2026-06-01T00:00:00Z",
        nodes: {
          terminal: { session_id: "s-root-b", display_name: "terminal", profile: "build" },
          impl: { session_id: "s-impl-b", display_name: "impl", profile: "build" },
          qa: { session_id: "s-qa-b", display_name: "qa", profile: "build" },
        },
      }),
    )

    const spec = await computeOfficeLayoutSpec(dir)
    await writeOfficeLayoutSpec(dir, spec)
    expect(workstationCountForAgents(spec.inner_nodes.length)).toBe(2)
    expect(spec.workstation_count).toBe(2)
    expect(spec.revision).toBe("ws:2")
    expect(spec.bindings.map((entry) => entry.spawn_id).sort()).toEqual(["impl", "qa", "terminal"])

    await writeFile(
      path.join(dir, ".gatehouse", "lead", "missions.yaml"),
      stringifyYaml({
        schema_version: 2,
        missions: [
          { id: "mission-a", status: "running", started_at: "2026-05-30T10:00:00Z" },
          { id: "mission-b", status: "done" },
          { id: "mission-done", status: "done" },
        ],
      }),
    )

    const afterDone = await computeOfficeLayoutSpec(dir)
    expect(afterDone.workstation_count).toBe(2)
    expect(afterDone.revision).toBe("ws:2")
    expect(afterDone.bindings.map((entry) => entry.spawn_id).sort()).toEqual(["leaf", "terminal"])
  })

  test("includes inner nodes from the newest done mission when idle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-office-layout-lingering-"))
    await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
    await mkdir(path.join(dir, ".gatehouse", "trees", "mission-last"), { recursive: true })

    await writeFile(
      path.join(dir, ".gatehouse", "lead", "missions.yaml"),
      stringifyYaml({
        schema_version: 2,
        missions: [
          { id: "mission-old", status: "done", started_at: "2026-05-30T10:00:00Z" },
          { id: "mission-last", status: "done", started_at: "2026-05-31T10:00:00Z" },
        ],
      }),
    )

    await writeFile(
      path.join(dir, ".gatehouse", "trees", "mission-last", "manifest.yaml"),
      stringifyYaml({
        mission_id: "mission-last",
        status: "archived",
        terminal_node: "terminal",
        created_at: "2026-06-01T00:00:00Z",
        nodes: {
          terminal: { session_id: "s-root", display_name: "terminal", profile: "build" },
          leaf: { session_id: "s-leaf", display_name: "leaf", profile: "build" },
        },
      }),
    )

    const spec = await computeOfficeLayoutSpec(dir)
    expect(spec.inner_nodes.map((node) => node.node_id).sort()).toEqual(["leaf", "terminal"])
    expect(spec.workstation_count).toBe(1)
  })
})
