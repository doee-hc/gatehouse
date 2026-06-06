import { describe, expect, test } from "bun:test"
import { resolveCorsOrigin, resolveProjectDirectory } from "../src/portal/security.ts"

describe("portal security", () => {
  test("resolveProjectDirectory rejects unknown directories", () => {
    const defaultDir = "/tmp/gatehouse-default-project"
    const request = new Request("http://127.0.0.1:8787/portal/api/snapshot?directory=/etc/passwd")
    const result = resolveProjectDirectory(new URL(request.url), request, defaultDir)
    expect(result.ok).toBe(false)
  })

  test("resolveProjectDirectory allows configured extra directories", () => {
    const defaultDir = "/tmp/gatehouse-default-project"
    const extraDir = "/tmp/gatehouse-extra-project"
    const prev = process.env.GATEHOUSE_PORTAL_PROJECT_DIRS
    process.env.GATEHOUSE_PORTAL_PROJECT_DIRS = extraDir
    try {
      const request = new Request(`http://127.0.0.1:8787/portal/api/snapshot?directory=${encodeURIComponent(extraDir)}`)
      const result = resolveProjectDirectory(new URL(request.url), request, defaultDir)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.directory).toBe(extraDir)
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_PORTAL_PROJECT_DIRS
      else process.env.GATEHOUSE_PORTAL_PROJECT_DIRS = prev
    }
  })

  test("resolveCorsOrigin allows localhost dev origins by default", () => {
    const request = new Request("http://127.0.0.1:8787/portal/api/snapshot", {
      headers: { Origin: "http://localhost:5174" },
    })
    expect(resolveCorsOrigin(request)).toBe("http://localhost:5174")
  })

  test("resolveCorsOrigin blocks unknown origins by default", () => {
    const request = new Request("http://127.0.0.1:8787/portal/api/snapshot", {
      headers: { Origin: "https://evil.example" },
    })
    expect(resolveCorsOrigin(request)).toBeUndefined()
  })

  test("resolveCorsOrigin honors configured allowlist", () => {
    const prev = process.env.GATEHOUSE_PORTAL_CORS_ORIGINS
    process.env.GATEHOUSE_PORTAL_CORS_ORIGINS = "https://portal.example.com"
    try {
      const allowed = new Request("http://127.0.0.1:8787/portal/api/snapshot", {
        headers: { Origin: "https://portal.example.com" },
      })
      const blocked = new Request("http://127.0.0.1:8787/portal/api/snapshot", {
        headers: { Origin: "http://localhost:5174" },
      })
      expect(resolveCorsOrigin(allowed)).toBe("https://portal.example.com")
      expect(resolveCorsOrigin(blocked)).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.GATEHOUSE_PORTAL_CORS_ORIGINS
      else process.env.GATEHOUSE_PORTAL_CORS_ORIGINS = prev
    }
  })
})
