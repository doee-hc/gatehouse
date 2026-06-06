import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  ensurePortalAdminKey,
  generatePortalAdminKey,
  readPortalAdminKeyFromConfig,
  resolvePortalAdminKey,
} from "../src/portal/config.ts"

function withProject(run: (projectDir: string) => void) {
  const projectDir = mkdtempSync(path.join(tmpdir(), "gh-portal-admin-"))
  mkdirSync(path.join(projectDir, ".gatehouse"), { recursive: true })
  try {
    run(projectDir)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
}

describe("portal admin key config", () => {
  test("generatePortalAdminKey returns a long base64url string", () => {
    const key = generatePortalAdminKey()
    expect(key.length).toBeGreaterThanOrEqual(40)
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("ensurePortalAdminKey writes portal.admin_key into config.yaml", () => {
    withProject((projectDir) => {
      const configPath = path.join(projectDir, ".gatehouse/config.yaml")
      writeFileSync(
        configPath,
        `schema_version: 1\nportal:\n  brand:\n    title: Test\nagents:\n  lead:\n    name: Len\n`,
      )

      const key = ensurePortalAdminKey(projectDir)
      expect(key.length).toBeGreaterThanOrEqual(40)
      expect(readPortalAdminKeyFromConfig(projectDir)).toBe(key)
      expect(resolvePortalAdminKey(projectDir)).toBe(key)

      const raw = readFileSync(configPath, "utf-8")
      expect(raw).toContain("admin_key:")
      expect(raw).toContain("title: Test")
    })
  })

  test("ensurePortalAdminKey is idempotent", () => {
    withProject((projectDir) => {
      writeFileSync(
        path.join(projectDir, ".gatehouse/config.yaml"),
        `portal:\n  admin_key: existing-secret\n`,
      )

      expect(ensurePortalAdminKey(projectDir)).toBe("existing-secret")
    })
  })

  test("resolvePortalAdminKey prefers env over config file", () => {
    withProject((projectDir) => {
      writeFileSync(
        path.join(projectDir, ".gatehouse/config.yaml"),
        `portal:\n  admin_key: from-file\n`,
      )
      const prev = process.env.GATEHOUSE_PORTAL_ADMIN_KEY
      process.env.GATEHOUSE_PORTAL_ADMIN_KEY = "from-env"
      try {
        expect(resolvePortalAdminKey(projectDir)).toBe("from-env")
      } finally {
        if (prev === undefined) delete process.env.GATEHOUSE_PORTAL_ADMIN_KEY
        else process.env.GATEHOUSE_PORTAL_ADMIN_KEY = prev
      }
    })
  })

  test("ensurePortalAdminKey migrates legacy portal.yaml", () => {
    withProject((projectDir) => {
      writeFileSync(path.join(projectDir, ".gatehouse/config.yaml"), `portal:\n  brand:\n    title: Test\n`)
      writeFileSync(path.join(projectDir, ".gatehouse/portal.yaml"), `adminKey: legacy-key\n`)

      expect(ensurePortalAdminKey(projectDir)).toBe("legacy-key")
      expect(readPortalAdminKeyFromConfig(projectDir)).toBe("legacy-key")
    })
  })
})
