import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import { resetPortalProjectSlugCacheForTests, resolvePortalProjectSlug } from "../src/portal/portal-project.ts"
import {
  assertPortalPortAvailable,
  notifyPortalPortInUse,
  PortalPortInUseError,
  portalHealthMatchesProject,
  probePortalEndpoints,
} from "../src/portal/ports.ts"
import { readTuiNotificationsFromOffset } from "../src/tui/notifications.ts"
import { startEphemeralServer } from "./portal-test-server.ts"

describe("portal ports", () => {
  test("portalHealthMatchesProject accepts project slug", () => {
    const project = "/tmp/portal-ports-project"
    expect(
      portalHealthMatchesProject(project, {
        project: "portal-ports-project",
      }),
    ).toBe(true)
    expect(
      portalHealthMatchesProject(project, {
        project: "other-project",
      }),
    ).toBe(false)
  })

  test("probePortalEndpoints checks configured ports only", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-portal-ports-"))
    resetPortalProjectSlugCacheForTests()
    const projectSlug = resolvePortalProjectSlug(project)
    const displayPort = 48787
    const adminPort = 48788
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.hostname === "127.0.0.1" && Number(url.port) === displayPort && url.pathname === "/portal/api/health") {
        return Response.json({
          ok: true,
          project: projectSlug,
          opencode_reachable: false,
          bridge_running: false,
          sse_active: 0,
        })
      }
      if (
        url.hostname === "127.0.0.1" &&
        Number(url.port) === adminPort &&
        url.pathname === "/portal/api/admin/status"
      ) {
        return Response.json({ configured: true }, { headers: { "Content-Type": "application/json" } })
      }
      return originalFetch(input)
    }

    try {
      const endpoints = await probePortalEndpoints(project, {
        displayPreferred: displayPort,
        adminPreferred: adminPort,
        displayApiEnv: `http://127.0.0.1:${displayPort}`,
        adminApiEnv: `http://127.0.0.1:${adminPort}`,
      })

      expect(endpoints.displayReachable).toBe(true)
      expect(endpoints.displayPort).toBe(displayPort)
      expect(endpoints.adminPort).toBe(adminPort)
      expect(endpoints.adminReachable).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      await Bun.$`rm -rf ${project}`.quiet()
    }
  })

  test("assertPortalPortAvailable fails when configured port is listening", async () => {
    const { server, port } = await startEphemeralServer(() => new Response("ok"))

    let thrown: unknown
    try {
      await assertPortalPortAvailable(port, "display")
    } catch (error) {
      thrown = error
    }
    expect(thrown instanceof PortalPortInUseError).toBe(true)

    server.stop()
  })

  test("notifyPortalPortInUse writes TUI notification", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "gh-portal-tui-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    const error = new PortalPortInUseError(8787, "display", "Port 8787 is already in use")
    notifyPortalPortInUse(projectDir, error)

    const { notifications } = readTuiNotificationsFromOffset(projectDir)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.title).toBe("Portal")
    expect(notifications[0]?.message).toBe("Port 8787 is already in use")
    expect(notifications[0]?.level).toBe("error")

    const logFile = path.join(projectDir, ".gatehouse", "logs", "gatehouse.log")
    expect(readFileSync(logFile, "utf8")).toContain("Port 8787 is already in use")
  })
})
