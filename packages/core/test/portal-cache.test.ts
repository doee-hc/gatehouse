import { expect, test } from "bun:test"
import { createPortalDataCache, officeRevisionCacheControl } from "../src/portal/portal-cache.ts"

test("createPortalDataCache returns cached value within ttl", async () => {
  const cache = createPortalDataCache<number>({ ttlMs: 60_000 })
  let loads = 0
  const load = async () => {
    loads += 1
    return loads
  }

  expect(await cache.get("a", load)).toBe(1)
  expect(await cache.get("a", load)).toBe(1)
  expect(loads).toBe(1)
  expect((cache.cacheAgeMs() ?? 0) >= 0).toBe(true)
})

test("createPortalDataCache deduplicates concurrent loads", async () => {
  const cache = createPortalDataCache<number>({ ttlMs: 60_000 })
  let loads = 0
  const load = async () => {
    loads += 1
    await Bun.sleep(20)
    return loads
  }

  const [first, second] = await Promise.all([cache.get("a", load), cache.get("a", load)])
  expect(first).toBe(1)
  expect(second).toBe(1)
  expect(loads).toBe(1)
})

test("createPortalDataCache reloads after key change", async () => {
  const cache = createPortalDataCache<number>({ ttlMs: 60_000 })
  let loads = 0
  const load = async () => ++loads

  expect(await cache.get("a", load)).toBe(1)
  expect(await cache.get("b", load)).toBe(2)
})

test("officeRevisionCacheControl uses immutable cache when revision is present", () => {
  expect(officeRevisionCacheControl("rev-1")).toBe("public, max-age=31536000, immutable")
  expect(officeRevisionCacheControl(undefined)).toBe("no-store")
  expect(officeRevisionCacheControl("")).toBe("no-store")
})
