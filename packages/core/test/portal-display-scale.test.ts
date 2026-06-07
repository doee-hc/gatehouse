import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  toBrowserBlog,
  toBrowserSnapshot,
  toBrowserTeamStats,
} from "../src/portal/browser-dto.ts"
import {
  resetPortalProjectSlugCacheForTests,
  resolvePortalProjectSlug,
  resolveProjectDirectoryBySlug,
  slugFromDirectoryName,
} from "../src/portal/portal-project.ts"
import {
  acquirePortalSseConnection,
  resetPortalSseRegistryForTests,
} from "../src/portal/sse-registry.ts"
import type { PortalSnapshot } from "../src/portal/snapshot.ts"
import type { TeamStatsSnapshot } from "../src/portal/team-stats.ts"
import type { BlogSnapshot } from "../src/portal/blog.ts"
import { gatehouseProjectConfigPath } from "../src/gatehouse-config.ts"

describe("portal project slug", () => {
  test("resolvePortalProjectSlug uses config override", async () => {
    resetPortalProjectSlugCacheForTests()
    const project = await mkdtemp(path.join(tmpdir(), "gh-portal-slug-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:\n  project_slug: gatehouse-live\n`,
      )
      resetPortalProjectSlugCacheForTests()
      expect(resolvePortalProjectSlug(project)).toBe("gatehouse-live")
      expect(resolveProjectDirectoryBySlug("gatehouse-live", project)).toBe(path.resolve(project))
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  test("slugFromDirectoryName normalizes basename", () => {
    expect(slugFromDirectoryName("/tmp/My Project_01")).toBe("my-project-01")
  })
})

describe("portal browser dto", () => {
  test("toBrowserSnapshot removes host paths and session ids", () => {
    const snapshot = {
      project_directory: "/home/user/secret-project",
      updated_at: "2026-01-01T00:00:00.000Z",
      missions: [],
      agents: [
        {
          agent_id: "outer:lead",
          scope: "outer" as const,
          profile: "lead",
          display_name: "Len",
          session_id: "ses_lead",
          status: "idle" as const,
          spawn_id: "lead",
        },
      ],
      skills: [],
      session_status: { ses_lead: "idle" },
      tree: {
        mission_id: "m1",
        root_node: "root",
        status: "running",
        nodes: [
          {
            node_id: "root",
            session_id: "ses_root",
            parent: null,
            display_name: "Root",
          },
        ],
      },
    } satisfies PortalSnapshot

    const browser = toBrowserSnapshot("/home/user/secret-project", snapshot)
    expect(browser.project).toBe("secret-project")
    expect("project_directory" in browser).toBe(false)
    expect("session_status" in browser).toBe(false)
    expect("session_id" in (browser.agents[0] ?? {})).toBe(false)
    expect("session_id" in (browser.tree?.nodes[0] ?? {})).toBe(false)
  })

  test("toBrowserTeamStats strips session ids", () => {
    const stats = {
      project_directory: "/tmp/demo",
      updated_at: "2026-01-01T00:00:00.000Z",
      opencode_reachable: true,
      outer: [
        {
          profile: "lead",
          label: "Len",
          session_id: "ses_lead",
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 }, total: 3 },
          cost: 0.01,
          duration_ms: 1000,
        },
      ],
      missions: [],
    } satisfies TeamStatsSnapshot

    const browser = toBrowserTeamStats("/tmp/demo", stats)
    expect(browser.project).toBe("demo")
    expect("session_id" in (browser.outer[0] ?? {})).toBe(false)
  })

  test("toBrowserBlog exposes project slug", () => {
    const blog = {
      project_directory: "/srv/gatehouse",
      updated_at: "2026-01-01T00:00:00.000Z",
      groups: [],
    } satisfies BlogSnapshot
    expect(toBrowserBlog("/srv/gatehouse", blog).project).toBe("gatehouse")
  })
})

describe("portal sse registry", () => {
  test("acquirePortalSseConnection tracks active slots", () => {
    resetPortalSseRegistryForTests()
    const first = acquirePortalSseConnection()
    const second = acquirePortalSseConnection()
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    first.ok && first.release()
    second.ok && second.release()
  })
})
