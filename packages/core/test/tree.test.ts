import { describe, expect, test } from "bun:test"
import {
  childNodeIds,
  isSoloExecutionTeam,
  manifestMembers,
  managerRetroOrder,
  parseTeamSpec,
  resolveInnerProfile,
  topologicalNodeOrder,
  validateTeamSpec,
} from "../src/tree/parse.ts"
import { parseTreeManifest } from "../src/tree/parse.ts"
import {
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
} from "../src/registry/types.ts"

const sampleSpec = `
mission_id: demo-mission
root: root
nodes:
  root:
    parent: null
    description: 任务协调者
  leaf:
    parent: root
    description: 执行成员
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
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("Invalid TeamSpec node")
  })

  test("parseTeamSpec rejects deprecated constraints field", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: demo-mission
root: root
nodes:
  root:
    parent: null
    description: 任务协调者
    constraints: "coord"
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("must not include constraints")
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

  test("resolveInnerProfile picks build-root, build-coordinator, and build by role", () => {
    const spec = parseTeamSpec(sampleSpec)
    expect(resolveInnerProfile(spec, "root")).toBe(INNER_ROOT_AGENT)
    expect(resolveInnerProfile(spec, "leaf")).toBe(INNER_EXECUTION_AGENT)
    const multi = parseTeamSpec(`
mission_id: multi
root: node-root
nodes:
  node-root:
    parent: null
    description: 根
  node-mid:
    parent: node-root
    description: 中层
  node-leaf:
    parent: node-mid
    description: 叶
`)
    expect(resolveInnerProfile(multi, "node-mid")).toBe(INNER_COORDINATOR_AGENT)
  })

  test("resolveInnerProfile uses build-root-solo for solo structural root", () => {
    const spec = parseTeamSpec(`
mission_id: solo
root: node-root
nodes:
  node-root:
    parent: null
    description: 单人根节点
`)
    expect(resolveInnerProfile(spec, "node-root")).toBe(INNER_ROOT_SOLO_AGENT)
  })

  test("parseTeamSpec rejects profile field on nodes", () => {
    let message = ""
    try {
      parseTeamSpec(`
mission_id: bad
root: root
nodes:
  root:
    parent: null
    description: 根
    profile: build-root
`)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("must not include profile")
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
    expect(isSoloExecutionTeam(manifest)).toBe(true)
  })

  test("isSoloExecutionTeam is false for multi-node trees", () => {
    const manifest = parseTreeManifest(`
mission_id: multi
status: running
root_node: root
created_at: "2026-01-01T00:00:00Z"
nodes:
  root:
    session_id: s1
    parent: null
  leaf:
    session_id: s2
    parent: root
`)
    expect(isSoloExecutionTeam(manifest)).toBe(false)
  })
})
