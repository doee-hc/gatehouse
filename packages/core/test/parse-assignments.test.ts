import { describe, expect, test } from "bun:test"
import { parseSkillDomainAssignments } from "../src/skills/parse-assignments.ts"

describe("parseSkillDomainAssignments", () => {
  test("parses array of node/domain pairs", () => {
    expect(
      parseSkillDomainAssignments([
        { node_id: "web-surveyor", domain_id: "domain-knowledge-survey" },
        { node_id: "html-author", domain_id: "reference-doc-authoring" },
      ]),
    ).toEqual({
      "web-surveyor": "domain-knowledge-survey",
      "html-author": "reference-doc-authoring",
    })
  })

  test("parses object map (legacy programmatic calls)", () => {
    expect(
      parseSkillDomainAssignments({
        "node-doc": "docs",
        "node-root": "docs",
      }),
    ).toEqual({
      "node-doc": "docs",
      "node-root": "docs",
    })
  })

  test("parses JSON string", () => {
    expect(
      parseSkillDomainAssignments(
        '{"web-surveyor":"domain-knowledge-survey","html-author":"reference-doc-authoring"}',
      ),
    ).toEqual({
      "web-surveyor": "domain-knowledge-survey",
      "html-author": "reference-doc-authoring",
    })
  })
})
