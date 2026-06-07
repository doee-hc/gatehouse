import path from "node:path"
import { loadGatehouseConfig } from "../gatehouse-config.ts"

const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

let slugCache = new Map<string, string>()

export function resetPortalProjectSlugCacheForTests() {
  slugCache.clear()
}

export function resolvePortalProjectSlug(projectDirectory: string) {
  const key = path.resolve(projectDirectory)
  const cached = slugCache.get(key)
  if (cached) return cached

  const config = loadGatehouseConfig(projectDirectory)
  const fromConfig = config.portal.project_slug?.trim()
  const slug =
    fromConfig && PROJECT_SLUG.test(fromConfig) ? fromConfig : slugFromDirectoryName(key)
  slugCache.set(key, slug)
  return slug
}

export function slugFromDirectoryName(projectDirectory: string) {
  const base = path.basename(projectDirectory)
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (normalized && PROJECT_SLUG.test(normalized)) return normalized
  return "project"
}

export function listKnownProjectDirectories(defaultProjectDirectory: string) {
  const raw = process.env.GATEHOUSE_PORTAL_PROJECT_DIRS?.trim()
  const extra = raw
    ? raw
        .split(",")
        .map((value) => path.resolve(value.trim()))
        .filter(Boolean)
    : []
  return [path.resolve(defaultProjectDirectory), ...extra]
}

export function resolveProjectDirectoryBySlug(
  slug: string,
  defaultProjectDirectory: string,
  extraDirectories: string[] = [],
) {
  const normalized = slug.trim()
  if (!normalized || !PROJECT_SLUG.test(normalized)) return undefined
  const candidates = [
    path.resolve(defaultProjectDirectory),
    ...extraDirectories.map((directory) => path.resolve(directory)),
  ]
  for (const directory of candidates) {
    if (resolvePortalProjectSlug(directory) === normalized) return directory
  }
  return undefined
}
