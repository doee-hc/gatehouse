import { describe, expect, test } from "bun:test"
import {
  childNodeIds,
  manifestMembers,
  managerRetroOrder,
  parseTeamSpec,
  resolveInnerProfile,
  topologicalNodeOrder,
  validateTeamSpec,
} from "../src/tree/parse.ts"
import { parseTreeManifest } from "../src/tree/parse.ts"
import { INNER_COORDINATOR_AGENT, INNER_EXECUTION_AGENT } from "../src/registry/types.ts"

const sampleSpec = `
mission_id: demo-mission
root: root
nodes:
  root:
    parent: null
    description: 任务协调者
    constraints: "coord"
  leaf:
    parent: root
    description: 执行成员
    constraints: "work"
`

describe("TeamSpec", () => {
  test("topological order places parent before child", () => {
    const spec = parseTeamSpec(sampleSpec)
    validateTeamSpec(spec)
    expect(topologicalNodeOrder(spec)).toEqual(["root", "leaf"])
  })

  test("parseTeamSpec rejects node without description", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
    parent: null
    constraints: "coord"
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("Invalid TeamSpec node")
  })

  test("validateTeamSpec rejects empty description", () => {
    let message = ""
    try {
      validateTeamSpec(
        parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
    parent: null
    description: "   "
    constraints: "coord"
`),
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("description")
  })

  test("parseTreeManifest reads description", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    parent: null
    description: 任务协调者
`)
    expect(manifest.nodes.root?.description).toBe("任务协调者")
  })

  test("manifestMembers includes description", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    parent: null
    description: 协调
  leaf:
    session_id: ses-2
    parent: root
    description: 执行
`)
    const members = manifestMembers(manifest)
    expect(members.find((item) => item.node_id === "root")?.description).toBe("协调")
    expect(members.find((item) => item.node_id === "leaf")?.description).toBe("执行")
  })

  test("resolveInnerProfile picks coordinator for managers and build for leaves", () => {
    const spec = parseTeamSpec(sampleSpec)
    expect(resolveInnerProfile(spec, "root")).toBe(INNER_COORDINATOR_AGENT)
    expect(resolveInnerProfile(spec, "leaf")).toBe(INNER_EXECUTION_AGENT)
  })

  test("resolveInnerProfile uses coordinator for solo structural root", () => {
    const spec = parseTeamSpec(`
mission_id: solo
root: node-root
nodes:
  node-root:
    parent: null
    description: 单人根节点
    constraints: |
      兼协调与执行
`)
    expect(resolveInnerProfile(spec, "node-root")).toBe(INNER_COORDINATOR_AGENT)
  })
})

describe("TreeManifest", () => {
  test("parseTreeManifest reads display_name", () => {
    const manifest = parseTreeManifest(`
mission_id: demo
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: ses-1
    parent: null
    display_name: root
`)
    expect(manifest.nodes.root?.display_name).toBe("root")
  })
})

describe("retro order", () => {
  test("managerRetroOrder is bottom-up", () => {
    const manifest = parseTreeManifest(`
mission_id: demo-mission
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: s1
    parent: null
  mid:
    session_id: s2
    parent: root
  leaf:
    session_id: s3
    parent: mid
`)
    expect(childNodeIds(manifest, "root")).toEqual(["mid"])
    expect(childNodeIds(manifest, "mid")).toEqual(["leaf"])
    expect(childNodeIds(manifest, "leaf")).toEqual([])
    expect(managerRetroOrder(manifest)).toEqual(["mid", "root"])
  })

  test("managerRetroOrder includes solo root when it has no children", () => {
    const manifest = parseTreeManifest(`
mission_id: solo-mission
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: s1
    parent: null
`)
    expect(childNodeIds(manifest, "root")).toEqual([])
    expect(managerRetroOrder(manifest)).toEqual(["root"])
  })
})
