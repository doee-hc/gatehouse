import { describe, expect, test } from "bun:test"
import { validatePlanStepStatement } from "../src/orchestration/plan-step-compile.ts"
import { trimPlanStatementChunk } from "../src/orchestration/plan-compile.ts"
import {
  inferAssignmentsFromDomains,
  parseUserSkillAssignments,
  resolveSkillDomainAssignments,
} from "../src/skills/resolve-assignments.ts"
import type { TeamSpec } from "../src/tree/types.ts"

describe("plan step compile", () => {
  test("wrapPlanStepStatement keeps replay wrapper valid when chunk ends with // comment", () => {
    const chunk = 'await ctx.run("a", { text: "go" })\n\n  // trailing comment'
    expect(validatePlanStepStatement(chunk).ok).toBe(true)
  })

  test("trimPlanStatementChunk removes trailing // lines from split chunks", () => {
    const chunk = 'await ctx.run("a", { text: "go" })\n\n  // trailing comment'
    expect(trimPlanStatementChunk(chunk)).toBe('await ctx.run("a", { text: "go" })')
  })
})

describe("skill domain auto resolve", () => {
  const surveyTeam: TeamSpec = {
    mission_id: "m1",
    root: "coordinator",
    nodes: {
      coordinator: { parent: null, description: "coord" },
      "researcher-a": { parent: "coordinator", description: "调研 Claude Code 最新动态" },
      "researcher-b": { parent: "coordinator", description: "调研 Cursor 最新动态" },
    },
  }

  const domains = [
    { id: "code-agent-claude", description: "Claude Code Agent SDK" },
    { id: "code-agent-cursor", description: "Cursor Composer" },
  ]

  test("parseUserSkillAssignments reads JSON user_skill", () => {
    expect(parseUserSkillAssignments('{"researcher-a":"code-agent-claude"}')).toEqual({
      "researcher-a": "code-agent-claude",
    })
  })

  test("inferAssignmentsFromDomains matches product names in descriptions", () => {
    const inferred = inferAssignmentsFromDomains(surveyTeam, domains)
    expect(inferred).toEqual({
      "researcher-a": "code-agent-claude",
      "researcher-b": "code-agent-cursor",
    })
  })

  test("resolveSkillDomainAssignments returns ready assignments for full leaf coverage", () => {
    const resolved = resolveSkillDomainAssignments(surveyTeam, { domains })
    expect(resolved?.source).toBe("inferred")
    expect(resolved?.assignments["researcher-a"]).toBe("code-agent-claude")
  })

  test("resolveSkillDomainAssignments stays undefined when leaf domain is ambiguous", () => {
    const team: TeamSpec = {
      mission_id: "m1",
      root: "root",
      nodes: {
        root: { parent: null, description: "root" },
        worker: { parent: "root", description: "文档执行成员，负责 README 示例章节" },
      },
    }
    expect(resolveSkillDomainAssignments(team, { domains })).toBeUndefined()
  })
})
