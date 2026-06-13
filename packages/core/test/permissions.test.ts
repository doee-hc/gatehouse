import { describe, expect, test } from "bun:test"
import {
  arbiterSessionPermissions,
  architectSessionPermissions,
  buildCoordinatorPermissions,
  buildExecutionPermissions,
  curatorSessionPermissions,
  hiddenToolsFromPermissions,
  injectAgentPermissionYaml,
  leadPermissions,
} from "../src/setup/permissions.ts"

const GATEHOUSE_TOOLS = [
  "gatehouse_init_team",
  "gatehouse_bootstrap_tree",
  "gatehouse_list_team",
  "gatehouse_send_message",
  "gatehouse_session_snapshot",
  "gatehouse_mission_start",
  "gatehouse_mission_info",
  "gatehouse_mission_retro",
  "gatehouse_mission_complete",
  "gatehouse_retro_record",
  "gatehouse_apply_skill_domains",
  "gatehouse_skill_extract_record",
  "gatehouse_inspector_queue",
  "gatehouse_inspector_decide",
  "gatehouse_unpublish_blog",
  "gatehouse_delivery_review",
  "gatehouse_delivery_status",
  "gatehouse_execution_complete",
  "gatehouse_execution_rework",
  "gatehouse_execution_status",
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

    const tools = hiddenToolsFromPermissions(buildCoordinatorPermissions)
    expect(tools.gatehouse_mission_start).toBe(false)
    expect(tools.gatehouse_mission_retro).toBe(false)
    expect(tools.gatehouse_mission_complete).toBe(false)
    expect(tools.gatehouse_send_message).toBeUndefined()
  })

  test("build profile denies mission lifecycle tools and allows mission_info", () => {
    expect(buildExecutionPermissions.gatehouse_mission_start).toBe("deny")
    expect(buildExecutionPermissions.gatehouse_mission_info).toBe("allow")
    const tools = hiddenToolsFromPermissions(buildExecutionPermissions)
    expect(tools.gatehouse_mission_start).toBe(false)
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
