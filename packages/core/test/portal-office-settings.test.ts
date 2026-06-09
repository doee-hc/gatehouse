import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { gatehouseProjectConfigPath } from "../src/gatehouse-config.ts"
import {
  getPortalOfficeSettings,
  initPortalOfficeSettings,
  resetPortalOfficeSettingsForTests,
  resolvePortalOfficeSettings,
  toBrowserOfficeConfig,
} from "../src/portal/portal-office-settings.ts"

describe("portal office settings", () => {
  afterEach(() => {
    resetPortalOfficeSettingsForTests()
  })

  test("defaults when config omits portal.office", () => {
    expect(resolvePortalOfficeSettings(process.cwd())).toEqual({
      idleWander: true,
      playRelease: "seat",
    })
  })

  test("reads portal.office from project config", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-office-config-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:
  office:
    idle_wander: false
    play_release: wander
`,
      )

      const settings = resolvePortalOfficeSettings(project)
      expect(settings).toEqual({ idleWander: false, playRelease: "wander" })
      expect(toBrowserOfficeConfig(settings)).toEqual({
        idle_wander: false,
        play_release: "wander",
      })
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })

  test("initPortalOfficeSettings caches active settings", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-office-init-"))
    try {
      await mkdir(path.join(project, ".gatehouse"), { recursive: true })
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:
  office:
    idle_wander: false
`,
      )

      initPortalOfficeSettings(project)
      expect(getPortalOfficeSettings()).toEqual({ idleWander: false, playRelease: "seat" })
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
