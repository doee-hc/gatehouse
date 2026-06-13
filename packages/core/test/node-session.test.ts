import { describe, expect, test } from "bun:test"
import { formatNodeRoleBlock } from "../src/execution/node-session.ts"
import { buildInnerBootstrapSystem } from "../src/execution/node-session.ts"
import { parseNodeBrief } from "../src/execution/brief.ts"

describe("node session bootstrap", () => {
  test("formatNodeRoleBlock includes description and brief hint", () => {
    const block = formatNodeRoleBlock("node-a", "文档执行成员", "zh")
    expect(block).toContain("node-a")
    expect(block).toContain("文档执行成员")
    expect(block).toContain("gatehouse_mission_info")
  })

  test("buildInnerBootstrapSystem composes role, context, and brief", () => {
    const brief = parseNodeBrief(
      `node_id: node-a
your_work:
  - write docs
acceptance_slice:
  - docs ok`,
      "node-a",
    )
    const system = buildInnerBootstrapSystem({
      nodeId: "node-a",
      description: "文档执行成员",
      locale: "zh",
      contract: {
        mission_id: "m1",
        status: "running",
        objective: "示例目标",
        done_when: ["done"],
        must_not: ["no secrets"],
        locked_at: "t",
        is_active: true,
      },
      brief,
    })
    expect(system).toContain("文档执行成员")
    expect(system).toContain("示例目标")
    expect(system).toContain("no secrets")
    expect(system).toContain("write docs")
  })
})
