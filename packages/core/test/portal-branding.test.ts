import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { buildPortalBranding } from "../src/portal/branding.ts"
import { gatehouseProjectConfigPath } from "../src/gatehouse-config.ts"

describe("portal branding api", () => {
  test("buildPortalBranding exposes logo_url when file exists", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "gh-branding-"))
    try {
      await mkdir(path.join(project, ".gatehouse/brand"), { recursive: true })
      const logoPath = path.join(project, ".gatehouse/brand/logo.png")
      await writeFile(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      await writeFile(
        gatehouseProjectConfigPath(project),
        `portal:\n  brand:\n    title: Acme\n    logo: brand/logo.png\n    icp_text: 沪ICP备00000000号\n    icp_url: https://beian.miit.gov.cn/\n`,
      )

      const url = new URL("http://127.0.0.1:8787/portal/api/branding")
      const branding = buildPortalBranding(project, url)

      expect(branding.title).toBe("Acme")
      expect(branding.icp_text).toBe("沪ICP备00000000号")
      expect(branding.icp_url).toBe("https://beian.miit.gov.cn/")
      expect(branding.logo_url).toContain("/portal/api/branding/logo?directory=")
    } finally {
      await rm(project, { recursive: true, force: true })
    }
  })
})
