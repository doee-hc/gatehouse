import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { gatehouseProjectConfigPath } from "../src/gatehouse-config.ts"
import {
  initPortalDisplaySettings,
  resetPortalDisplaySettingsForTests,
  resolvePortalDisplaySettings,
} from "../src/portal/portal-display-settings.ts"
import { resolveCorsOrigin } from "../src/portal/security.ts"

describe("portal display settings", () => {
  const envKeys = [
    "GATEHOUSE_PORTAL_SSE_MAX",
    "GATEHOUSE_PORTAL_SNAPSHOT_TTL_MS",
    "GATEHOUSE_PORTAL_TEAM_STATS_TTL_MS",
    "GATEHOUSE_PORTAL_BLOG_TTL_MS",
    "GATEHOUSE_PORTAL_CORS_ORIGINS",
    "GATEHOUSE_SNAPSHOT_POLL_MS",
    "GATEHOUSE_TEAM_STATS_POLL_MS",
    "GATEHOUSE_GLOBAL_CONFIG_DIR",
  ] as const

  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

  afterEach(() => {
    resetPortalDisplaySettingsForTests()
    for (const key of envKeys) {
      const value = previousEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("resolvePortalDisplaySettings merges project config over defaults", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-display-config-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:
  display:
    sse_max: 120
    snapshot_ttl_ms: 7000
    team_stats_ttl_ms: 11000
    blog_ttl_ms: 45000
    cors_origins:
      - https://live.example.com
    snapshot_poll_ms: 15000
    team_stats_poll_ms: 12000
`,
      )

      const settings = resolvePortalDisplaySettings(project)
      expect(settings).toEqual({
        sseMax: 120,
        snapshotTtlMs: 7000,
        teamStatsTtlMs: 11000,
        blogTtlMs: 45000,
        corsOrigins: ["https://live.example.com"],
        snapshotPollMs: 15000,
        teamStatsPollMs: 12000,
      })
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  test("environment variables override config file values", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-display-env-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:
  display:
    sse_max: 120
    snapshot_poll_ms: 15000
`,
      )
      process.env.GATEHOUSE_PORTAL_SSE_MAX = "240"
      process.env.GATEHOUSE_SNAPSHOT_POLL_MS = "9000"

      const settings = resolvePortalDisplaySettings(project)
      expect(settings.sseMax).toBe(240)
      expect(settings.snapshotPollMs).toBe(9000)
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  test("initPortalDisplaySettings feeds CORS allowlist", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-display-cors-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:
  display:
    cors_origins:
      - https://portal.example.com
`,
      )
      initPortalDisplaySettings(project)

      const allowed = new Request("http://127.0.0.1/portal/api/snapshot", {
        headers: { Origin: "https://portal.example.com" },
      })
      expect(resolveCorsOrigin(allowed)).toBe("https://portal.example.com")
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
