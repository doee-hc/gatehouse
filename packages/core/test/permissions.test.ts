import { describe, expect, test } from "bun:test"
import {
  arbiterSessionPermissions,
  architectSessionPermissions,
  buildCoordinatorPermissions,
  buildExecutionPermissions,
  buildExtractPermissions,
  buildRootPermissions,
  buildVerifyPermissions,
  curatorSessionPermissions,
  hiddenToolsFromPermissions,
  injectAgentPermissionYaml,
  leadPermissions,
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
  "gatehouse_delivery_status",
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
  test("build-root-solo allows task", async () => {
    const { buildRootSoloPermissions } = await import("../src/setup/permissions.ts")
    expect(buildRootSoloPermissions.task).toBe("allow")
  })

  test("inner coordinators deny unpublish_blog and hide it from tool schema", () => {
    const coordinator = buildCoordinatorPermissions as Record<string, unknown>
    expect(coordinator.gatehouse_unpublish_blog).toBe("deny")

    const tools = hiddenToolsFromPermissions(buildCoordinatorPermissions)
    expect(tools.gatehouse_unpublish_blog).toBe(false)
  })

  test("lead allows unpublish_blog only (publish is system-managed on mission_complete)", () => {
    expect(leadPermissions.gatehouse_unpublish_blog).toBe("allow")
  })

  test("build-coordinator denies mission lifecycle tools and hides them from tool schema", () => {
    expect(buildCoordinatorPermissions.gatehouse_mission_start).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_mission_retro).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_mission_complete).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_mission_info).toBe("allow")
    expect(buildCoordinatorPermissions.gatehouse_skill_extract_record).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_skill_verify_record).toBe("deny")

    const tools = hiddenToolsFromPermissions(buildCoordinatorPermissions)
    expect(tools.gatehouse_mission_start).toBe(false)
    expect(tools.gatehouse_mission_retro).toBe(false)
    expect(tools.gatehouse_mission_complete).toBe(false)
    expect(tools.gatehouse_send_message).toBe(false)
  })

  test("build profile denies skill record tools", () => {
    expect(buildExecutionPermissions.gatehouse_skill_extract_record).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_skill_verify_record).toBe("deny")
  })

  test("build profile denies mission lifecycle tools and allows mission_info", () => {
    expect(buildExecutionPermissions.gatehouse_mission_start).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_mission_info).toBe("allow")
    const tools = hiddenToolsFromPermissions(buildExecutionPermissions)
    expect(tools.gatehouse_mission_start).toBe(false)
  })

  test("build leaf denies peer coordination and orchestration reads", () => {
    expect(buildExecutionPermissions.gatehouse_send_message).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_list_team).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_session_snapshot).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_execution_status).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_retro_record).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_apply_skill_domains).toBe("deny")

    const tools = hiddenToolsFromPermissions(buildExecutionPermissions)
    expect(tools.gatehouse_send_message).toBe(false)
    expect(tools.gatehouse_session_snapshot).toBe(false)
    expect(tools.gatehouse_execution_status).toBe(false)
  })

  test("build leaf restricts skills to domain skills only", () => {
    const skill = buildExecutionPermissions.skill as Record<string, string>
    expect(skill["*"]).toBe("allow")
    expect(skill["lead-meta"]).toBe("deny")
    expect(skill["architect-meta"]).toBe("deny")
  })

  test("intermediate coordinator denies orchestration reads and send_message", () => {
    expect(buildCoordinatorPermissions.gatehouse_execution_status).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_delivery_status).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_submit_orchestration).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_send_message).toBe("deny")
    expect(buildCoordinatorPermissions.gatehouse_session_snapshot).toBe("deny")
  })

  test("structural root denies session_snapshot", () => {
    expect(buildRootPermissions.gatehouse_session_snapshot).toBe("deny")
    const tools = hiddenToolsFromPermissions(buildRootPermissions)
    expect(tools.gatehouse_session_snapshot).toBe(false)
  })

  test("structural root denies send_message tool", () => {
    expect(buildRootPermissions.gatehouse_send_message).toBe("deny")
    const tools = hiddenToolsFromPermissions(buildRootPermissions)
    expect(tools.gatehouse_send_message).toBe(false)
  })

  test("structural root allows orchestration reads", () => {
    expect(buildRootPermissions.gatehouse_execution_status).toBe("allow")
    expect(buildRootPermissions.gatehouse_delivery_status).toBe("allow")
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

  test("injects skill denylists for build-coordinator", () => {
    const template = `---
name: build-coordinator
permission:
  task: deny
---
body
`
    const result = injectAgentPermissionYaml(template, "build-coordinator.md")
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
  test("build leaf denies all .gatehouse paths on read", () => {
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
    expect(read[".gatehouse/trees/**"]).toBe("allow")
    expect(read[".gatehouse/lead/**"]).toBe("deny")
    expect(read[".gatehouse/skills/curator-meta/**"]).toBe("deny")
    expect(read[".gatehouse/en/prompts/architect/**"]).toBe("allow")
  })

  test("curator allows by-domain skills and blocks architect prompts except extract template", () => {
    const read = curatorSessionPermissions.read as Record<string, string>
    expect(read[".gatehouse/skills/by-domain/**"]).toBe("allow")
    expect(read[".gatehouse/trees/**/mission.script.ts"]).toBe("deny")
    expect(read[".gatehouse/en/prompts/architect/domain-skill-extract.md"]).toBe("allow")
    expect(read[".gatehouse/en/prompts/architect/**"]).toBe("deny")
    expect(read[".gatehouse/lead/**"]).toBe("deny")
  })

  test("inner retro coordinator allows node reports only under trees", () => {
    const read = buildCoordinatorPermissions.read as Record<string, string>
    expect(read[".gatehouse/trees/**/reports/nodes/**"]).toBe("allow")
    expect(read[".gatehouse/**"]).toBe("deny")
  })

  test("extract profile allows skill pipeline paths only", () => {
    const read = buildExtractPermissions.read as Record<string, string>
    expect(read[".gatehouse/trees/**/reports/skills/**"]).toBe("allow")
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
