import { describe, expect, test } from "bun:test"
import {
  arbiterSessionPermissions,
  architectSessionPermissions,
  buildExecutionPermissions,
  buildExtractPermissions,
  buildVerifyPermissions,
  curatorSessionPermissions,
  hiddenToolsFromPermissions,
  injectAgentPermissionYaml,
  leadPermissions,
  retroAnalystPermissions,
} from "../src/setup/permissions.ts"
import { GATEHOUSE_RETRO_TOOLKIT_SKILL } from "../src/skills/constants.ts"

const GATEHOUSE_TOOLS = [
  "gatehouse_init_team",
  "gatehouse_submit_orchestration",
  "gatehouse_list_team",
  "gatehouse_send_message",
  "gatehouse_session_snapshot",
  "gatehouse_mission_start",
  "gatehouse_mission_info",
  "gatehouse_mission_retro",
  "gatehouse_mission_complete",
  "gatehouse_retro_record",
  "gatehouse_retro_summary_record",
  "gatehouse_apply_skill_domains",
  "gatehouse_skill_extract_record",
  "gatehouse_skill_verify_record",
  "gatehouse_skill_summary_record",
  "gatehouse_inspector_queue",
  "gatehouse_inspector_decide",
  "gatehouse_unpublish_blog",
  "gatehouse_delivery_review",
  "gatehouse_execution_complete",
  "gatehouse_execution_rework",
  "gatehouse_execution_status",
  "gatehouse_direction_status",
] as const

const OUTER_PERMISSIONS = {
  lead: leadPermissions,
  architect: architectSessionPermissions,
  curator: curatorSessionPermissions,
  arbiter: arbiterSessionPermissions,
} as const

describe("outer agent permission matrix", () => {
  test("every outer profile declares all gatehouse tools explicitly", () => {
    for (const [profile, permission] of Object.entries(OUTER_PERMISSIONS)) {
      const map = permission as Record<string, unknown>
      for (const tool of GATEHOUSE_TOOLS) {
        expect(map[tool] !== undefined).toBe(true)
      }
    }
  })

  test("record tools are denied for all outer profiles", () => {
    for (const [profile, permission] of Object.entries(OUTER_PERMISSIONS)) {
      expect(permission.gatehouse_retro_record).toBe("deny")
      expect(permission.gatehouse_skill_extract_record).toBe("deny")
      expect(permission.gatehouse_skill_verify_record).toBe("deny")
    }
  })

  test("inspector tools are arbiter-only among outer profiles", () => {
    expect(arbiterSessionPermissions.gatehouse_inspector_queue).toBe("allow")
    expect(arbiterSessionPermissions.gatehouse_inspector_decide).toBe("allow")
    for (const [profile, permission] of Object.entries(OUTER_PERMISSIONS)) {
      if (profile === "arbiter") continue
      expect(permission.gatehouse_inspector_queue).toBe("deny")
      expect(permission.gatehouse_inspector_decide).toBe("deny")
    }
  })
})

describe("inner execution permission matrix", () => {
  test("build allows task", () => {
    expect(buildExecutionPermissions.task).toBe("allow")
  })

  test("build denies mission lifecycle tools and hides them from tool schema", () => {
    expect(buildExecutionPermissions.gatehouse_mission_start).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_mission_retro).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_mission_complete).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_mission_info).toBe("allow")
    expect(buildExecutionPermissions.gatehouse_skill_extract_record).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_skill_verify_record).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_unpublish_blog).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_send_message).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_list_team).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_session_snapshot).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_execution_status).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_submit_orchestration).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_retro_record).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_apply_skill_domains).toBe("deny")

    const tools = hiddenToolsFromPermissions(buildExecutionPermissions)
    expect(tools.gatehouse_mission_start).toBe(false)
    expect(tools.gatehouse_mission_retro).toBe(false)
    expect(tools.gatehouse_mission_complete).toBe(false)
    expect(tools.gatehouse_send_message).toBe(false)
    expect(tools.gatehouse_unpublish_blog).toBe(false)
    expect(tools.gatehouse_session_snapshot).toBe(false)
    expect(tools.gatehouse_execution_status).toBe(false)
  })

  test("build restricts skills to domain skills only", () => {
    const skill = buildExecutionPermissions.skill as Record<string, string>
    expect(skill["*"]).toBe("allow")
    expect(skill["lead-meta"]).toBe("deny")
    expect(skill["architect-meta"]).toBe("deny")
  })

  test("all inner profiles deny list_team", () => {
    for (const permission of [
      buildExecutionPermissions,
      buildExtractPermissions,
      buildVerifyPermissions,
      retroAnalystPermissions,
    ]) {
      expect(permission.gatehouse_list_team).toBe("deny")
      const tools = hiddenToolsFromPermissions(permission)
      expect(tools.gatehouse_list_team).toBe(false)
    }
  })

  test("extract profile allows only extract_record among gatehouse tools", () => {
    expect(buildExtractPermissions.gatehouse_skill_extract_record).toBe("allow")
    expect(buildExtractPermissions.gatehouse_skill_verify_record).toBe("deny")
    expect(buildExtractPermissions.gatehouse_mission_info).toBe("deny")
    expect(buildExtractPermissions.gatehouse_list_team).toBe("deny")
    expect(buildExtractPermissions.gatehouse_send_message).toBe("deny")
    expect(buildExtractPermissions.gatehouse_session_snapshot).toBe("deny")

    const skill = buildExtractPermissions.skill as Record<string, string>
    expect(skill[GATEHOUSE_RETRO_TOOLKIT_SKILL]).toBe("deny")
  })

  test("verify profile allows only verify_record among gatehouse tools", () => {
    expect(buildVerifyPermissions.gatehouse_skill_verify_record).toBe("allow")
    expect(buildVerifyPermissions.gatehouse_skill_extract_record).toBe("deny")
    expect(buildVerifyPermissions.gatehouse_mission_info).toBe("deny")
    expect(buildVerifyPermissions.gatehouse_list_team).toBe("deny")
    expect(buildVerifyPermissions.gatehouse_send_message).toBe("deny")
    expect(buildVerifyPermissions.gatehouse_session_snapshot).toBe("deny")

    const skill = buildVerifyPermissions.skill as Record<string, string>
    expect(skill[GATEHOUSE_RETRO_TOOLKIT_SKILL]).toBe("deny")
  })

  test("extract and verify declare all gatehouse tools explicitly", () => {
    for (const permission of [buildExtractPermissions, buildVerifyPermissions]) {
      const map = permission as Record<string, unknown>
      for (const tool of GATEHOUSE_TOOLS) {
        expect(map[tool] !== undefined).toBe(true)
      }
    }
  })
})

describe("hiddenToolsFromPermissions", () => {
  test("maps every deny permission to tools false", () => {
    const tools = hiddenToolsFromPermissions(leadPermissions)
    for (const [key, value] of Object.entries(leadPermissions)) {
      if (typeof value === "object") continue
      if (value === "deny") expect(tools[key]).toBe(false)
      else expect(tools[key]).toBeUndefined()
    }
  })

  test("includes arbiter shell and mission denies", () => {
    const tools = hiddenToolsFromPermissions(arbiterSessionPermissions)
    expect(tools.shell).toBe(false)
    expect(tools.gatehouse_send_message).toBe(false)
    expect(tools.gatehouse_inspector_queue).toBeUndefined()
    expect(tools.gatehouse_inspector_decide).toBeUndefined()
    expect(tools.gatehouse_mission_info).toBe(false)
  })
})

describe("injectAgentPermissionYaml", () => {
  test("injects skill allowlists for lead", () => {
    const template = `---
name: lead
permission:
  task: deny
---
body
`
    const result = injectAgentPermissionYaml(template, "lead.md")
    expect(result).toContain("skill:\n    *: deny")
    expect(result).toContain("lead-meta: allow")
  })

  test("injects skill denylists for build", () => {
    const template = `---
name: build
permission:
  task: deny
---
body
`
    const result = injectAgentPermissionYaml(template, "build.md")
    expect(result).toContain("architect-meta: deny")
    expect(result).toContain("*: allow")
    expect(result).toContain("gatehouse_mission_start: deny")
    expect(result).toContain("gatehouse_skill_extract_record: deny")
    expect(result).toContain("gatehouse_skill_verify_record: deny")
    expect(result).toContain("gatehouse_mission_start: false")
    expect(result).toContain("gatehouse_mission_info: allow")
  })

  test("injects hidden tools derived from deny permissions for lead", () => {
    const template = `---
name: lead
permission:
  task: deny
---
body
`
    const result = injectAgentPermissionYaml(template, "lead.md")
    expect(result).toContain("tools:\n  task: false")
    expect(result).toContain("gatehouse_inspector_queue: false")
    expect(result).not.toContain("gatehouse_send_message: false")
  })

  test("injects arbiter hidden tools for denied capabilities", () => {
    const template = `---
name: arbiter
permission:
  bash: deny
---
body
`
    const result = injectAgentPermissionYaml(template, "arbiter.md")
    expect(result).toContain("tools:\n  task: false")
    expect(result).toContain("bash: false")
    expect(result).not.toContain("gatehouse_inspector_queue: false")
    expect(result).toContain("gatehouse_inspector_queue: allow")
  })
})

describe("gatehouse path permissions", () => {
  test("build denies all .gatehouse paths on read", () => {
    const read = buildExecutionPermissions.read as Record<string, string>
    expect(read["*"]).toBe("allow")
    expect(read[".gatehouse/**"]).toBe("deny")
    expect(read[".gatehouse/registry.db"]).toBe("deny")
  })

  test("lead allows lead tree but not architect meta skills", () => {
    const read = leadPermissions.read as Record<string, string>
    expect(read[".gatehouse/lead/**"]).toBe("allow")
    expect(read[".gatehouse/skills/architect-meta/**"]).toBe("deny")
    expect(read[".gatehouse/en/prompts/architect/**"]).toBe("deny")
    expect(read[".gatehouse/skills/lead-meta/**"]).toBe("allow")
  })

  test("architect allows mission trees but not lead queue", () => {
    const read = architectSessionPermissions.read as Record<string, string>
    expect(read[".gatehouse/missions/**"]).toBe("allow")
    expect(read[".gatehouse/lead/**"]).toBe("deny")
    expect(read[".gatehouse/skills/curator-meta/**"]).toBe("deny")
    expect(read[".gatehouse/en/prompts/architect/**"]).toBe("allow")
  })

  test("curator allows by-domain skills and blocks architect prompts except extract template", () => {
    const read = curatorSessionPermissions.read as Record<string, string>
    expect(read[".gatehouse/skills/by-domain/**"]).toBe("allow")
    expect(read[".gatehouse/missions/**/mission.script.ts"]).toBe("deny")
    expect(read[".gatehouse/en/prompts/architect/domain-skill-extract.md"]).toBe("allow")
    expect(read[".gatehouse/en/prompts/architect/**"]).toBe("deny")
    expect(read[".gatehouse/lead/**"]).toBe("deny")
  })

  test("retro analyst allows retro summary and context reads only under trees", () => {
    const read = retroAnalystPermissions.read as Record<string, string>
    expect(read[".gatehouse/missions/**/context/**"]).toBe("allow")
    expect(read[".gatehouse/missions/**/reports/retro-summary.md"]).toBe("allow")
    expect(read[".gatehouse/**"]).toBe("deny")
  })

  test("extract profile allows skill pipeline paths only", () => {
    const read = buildExtractPermissions.read as Record<string, string>
    expect(read[".gatehouse/missions/**/reports/skills/**"]).toBe("allow")
    expect(read[".gatehouse/skills/by-domain/**"]).toBe("allow")
    expect(read[".gatehouse/**"]).toBe("deny")
  })

  test("injectAgentPermissionYaml emits nested read path rules for build", () => {
    const template = `---
name: build
permission:
  task: allow
---
body
`
    const result = injectAgentPermissionYaml(template, "build.md")
    expect(result).toContain("read:")
    expect(result).toContain(".gatehouse/**: deny")
  })
})
