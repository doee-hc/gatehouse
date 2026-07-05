import { describe, expect, test } from "bun:test"
import { validatePlanStepStatement } from "../src/orchestration/plan-step-compile.ts"
import { trimPlanStatementChunk } from "../src/orchestration/plan-compile.ts"
import {
  inferAssignmentsFromDomains,
  parseUserSkillAssignments,
  resolveSkillDomainAssignments,
} from "../src/skills/resolve-assignments.ts"
import type { OrchestrationPlan } from "../src/orchestration/plan-types.ts"
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
    terminal: "coordinator",
    nodes: {
      coordinator: { description: "coord" },
      "researcher-a": { description: "调研 Claude Code 最新动态" },
      "researcher-b": { description: "调研 Cursor 最新动态" },
    },
  }

  const domains = [
    { id: "code-agent-claude", description: "Claude Code Agent SDK" },
    { id: "code-agent-cursor", description: "Cursor Composer" },
  ]
  const surveyPlan: OrchestrationPlan = {
    schema_version: 1,
    mission_id: "m1",
    plan_version: "v1",
    script_hash: "hash",
    warnings: [],
    steps: [
      { id: "step-0", op: "run", statement: 'await ctx.run("researcher-a", { text: "go" })', nodeId: "researcher-a" },
      { id: "step-1", op: "run", statement: 'await ctx.run("researcher-b", { text: "go" })', nodeId: "researcher-b" },
      {
        id: "step-2",
        op: "run",
        statement:
          'await ctx.run("coordinator", { text: "summary", dependsOn: [{ node: "researcher-a", deliverable: true }, { node: "researcher-b", deliverable: true }] })',
        nodeId: "coordinator",
      },
    ],
  }

  test("parseUserSkillAssignments reads JSON user_skill", () => {
    expect(parseUserSkillAssignments('{"researcher-a":"code-agent-claude"}')).toEqual({
      "researcher-a": "code-agent-claude",
    })
  })

  test("inferAssignmentsFromDomains matches product names in descriptions", () => {
    const inferred = inferAssignmentsFromDomains(surveyTeam, surveyPlan, domains)
    expect(inferred).toEqual({
      "researcher-a": "code-agent-claude",
      "researcher-b": "code-agent-cursor",
    })
  })

  test("resolveSkillDomainAssignments returns ready assignments for full leaf coverage", () => {
    const resolved = resolveSkillDomainAssignments(surveyTeam, surveyPlan, { domains })
    expect(resolved?.source).toBe("inferred")
    expect(resolved?.assignments["researcher-a"]).toBe("code-agent-claude")
  })

  test("resolveSkillDomainAssignments stays undefined when leaf domain is ambiguous", () => {
    const team: TeamSpec = {
      mission_id: "m1",
      terminal: "terminal",
      nodes: {
        terminal: { description: "root" },
        worker: { description: "文档执行成员，负责 README 示例章节" },
      },
    }
    const plan: OrchestrationPlan = {
      schema_version: 1,
      mission_id: "m1",
      plan_version: "v1",
      script_hash: "hash",
      warnings: [],
      steps: [
        { id: "step-0", op: "run", statement: 'await ctx.run("worker", { text: "go" })', nodeId: "worker" },
        {
          id: "step-1",
          op: "run",
          statement: 'await ctx.run("terminal", { text: "summary", dependsOn: [{ node: "worker", deliverable: true }] })',
          nodeId: "terminal",
        },
      ],
    }
    expect(resolveSkillDomainAssignments(team, plan, { domains })).toBeUndefined()
  })
})
