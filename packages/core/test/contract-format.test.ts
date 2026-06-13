import { describe, expect, test } from "bun:test"
import {
  formatMissionContractBlock,
  formatMissionContractForRole,
} from "../src/missions/contract-format.ts"
import type { MissionContract } from "../src/missions/contract.ts"

const baseContract = (): MissionContract => ({
  mission_id: "m1",
  status: "running",
  objective: "obj",
  done_when: ["a"],
  must_not: ["b"],
  notes: "用户背景说明",
  user_topology: "用户要求 solo",
  user_skill: "文档用 docs domain",
  locked_at: "t",
  is_active: true,
})

describe("mission contract format by role", () => {
  test("formatMissionContractBlock includes all override fields", () => {
    const block = formatMissionContractBlock(baseContract(), "zh")
    expect(block).toContain("用户背景说明")
    expect(block).toContain("用户要求 solo")
    expect(block).toContain("文档用 docs domain")
  })

  test("architect role includes user_topology and notes but not user_skill", () => {
    const block = formatMissionContractForRole(baseContract(), "zh", "architect")
    expect(block).toContain("用户背景说明")
    expect(block).toContain("用户要求 solo")
    expect(block).not.toContain("docs domain")
    expect(block).not.toContain("user_skill")
  })

  test("curator role includes user_skill only from override fields", () => {
    const block = formatMissionContractForRole(baseContract(), "zh", "curator")
    expect(block).toContain("文档用 docs domain")
    expect(block).not.toContain("用户背景说明")
    expect(block).not.toContain("用户要求 solo")
  })

  test("curator role omits skill section when user_skill unset", () => {
    const block = formatMissionContractForRole(
      { ...baseContract(), user_skill: undefined },
      "zh",
      "curator",
    )
    expect(block).not.toContain("user_skill")
    expect(block).not.toContain("用户指定 skill")
  })

  test("execution role omits portal publish criteria from done_when", () => {
    const block = formatMissionContractForRole(
      {
        ...baseContract(),
        done_when: ["文件存在: reports/a.html", "报告被发布到 Portal", "设计美观"],
      },
      "zh",
      "architect",
    )
    expect(block).toContain("文件存在: reports/a.html")
    expect(block).toContain("设计美观")
    expect(block).not.toContain("发布到 Portal")
  })

  test("execution role is not used for formatted blocks (no notes in mission context)", () => {
    const block = formatMissionContractForRole(baseContract(), "zh", "execution")
    expect(block).not.toContain("用户背景说明")
    expect(block).not.toContain("用户要求 solo")
    expect(block).not.toContain("docs domain")
  })
})
