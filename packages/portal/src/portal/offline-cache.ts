import type { PortalBranding } from "../api/branding.ts"
import type { BlogSnapshot, PortalSnapshot } from "../api/types.ts"
import type { PortalDisplayConfig } from "../portal/poll-intervals.ts"

const LAST_PROJECT_KEY = "gatehouse/portal-offline/last-project"
const CACHE_VERSION = 1

type OfflineBundle = {
  v: typeof CACHE_VERSION
  savedAt: string
  snapshot?: PortalSnapshot
  blog?: BlogSnapshot
  branding?: PortalBranding
  displayConfig?: PortalDisplayConfig
}

function cacheKey(project: string) {
  return `gatehouse/portal-offline/${project}`
}

function readRaw(key: string): OfflineBundle | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as OfflineBundle
    if (parsed.v !== CACHE_VERSION) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function writeRaw(key: string, bundle: OfflineBundle) {
  try {
    localStorage.setItem(key, JSON.stringify(bundle))
  } catch (error) {
    console.warn("[portal] failed to write offline cache", error)
  }
}

export function readLastCachedProjectSlug() {
  try {
    const direct = localStorage.getItem(LAST_PROJECT_KEY)
    if (direct) return direct

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith("gatehouse/portal-offline/")) continue
      const slug = key.slice("gatehouse/portal-offline/".length)
      if (slug && readRaw(key)?.snapshot) return slug
    }
  } catch {
    return undefined
  }
  return undefined
}

export function rememberCachedProjectSlug(project: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, project)
  } catch (error) {
    console.warn("[portal] failed to remember project slug", error)
  }
}

export function readOfflineBundle(project: string) {
  return readRaw(cacheKey(project))
}

export function mergeOfflineBundle(
  project: string,
  patch: Partial<Pick<OfflineBundle, "snapshot" | "blog" | "branding" | "displayConfig">>,
) {
  const prev = readOfflineBundle(project)
  const next: OfflineBundle = {
    v: CACHE_VERSION,
    savedAt: new Date().toISOString(),
    snapshot: patch.snapshot ?? prev?.snapshot,
    blog: patch.blog ?? prev?.blog,
    branding: patch.branding ?? prev?.branding,
    displayConfig: patch.displayConfig ?? prev?.displayConfig,
  }
  writeRaw(cacheKey(project), next)
  rememberCachedProjectSlug(project)
}
