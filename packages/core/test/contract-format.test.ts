import { describe, expect, test } from "bun:test"
import {
  filterMissionNotesForAudience,
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
  notes: [
    "用户背景说明",
    "[用户指定·拓扑] 用户要求 solo",
    "[用户指定·skill] 文档用 docs domain",
  ].join("\n"),
  locked_at: "t",
  is_active: true,
})

describe("mission contract format by role", () => {
  test("formatMissionContractBlock includes all notes", () => {
    const block = formatMissionContractBlock(baseContract(), "zh")
    expect(block).toContain("用户背景说明")
    expect(block).toContain("[用户指定·拓扑]")
    expect(block).toContain("[用户指定·skill]")
  })

  test("architect role strips skill-specified notes only", () => {
    const block = formatMissionContractForRole(baseContract(), "zh", "architect")
    expect(block).toContain("用户背景说明")
    expect(block).toContain("[用户指定·拓扑]")
    expect(block).not.toContain("[用户指定·skill]")
    expect(block).not.toContain("docs domain")
  })

  test("curator role keeps only skill-specified notes", () => {
    const block = formatMissionContractForRole(baseContract(), "zh", "curator")
    expect(block).toContain("[用户指定·skill]")
    expect(block).not.toContain("用户背景说明")
    expect(block).not.toContain("[用户指定·拓扑]")
  })

  test("curator role omits notes section when no skill prefix", () => {
    const block = formatMissionContractForRole(
      { ...baseContract(), notes: "仅背景\n[用户指定·拓扑] solo" },
      "zh",
      "curator",
    )
    expect(block).not.toContain("备注")
    expect(block).not.toContain("仅背景")
  })

  test("execution role never includes notes", () => {
    expect(filterMissionNotesForAudience(baseContract().notes, "execution")).toBeUndefined()
  })

  test("english skill prefix works for curator", () => {
    const notes = "[user-specified·skill] Use docs domain"
    expect(filterMissionNotesForAudience(notes, "curator")).toBe(notes)
    const block = formatMissionContractForRole(
      { ...baseContract(), notes: "bg\n[user-specified·skill] Use docs" },
      "en",
      "curator",
    )
    expect(block).toContain("[user-specified·skill]")
    expect(block).not.toContain("bg")
  })
})
