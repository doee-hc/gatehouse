import {
  mergeOfflineBundle,
  readLastCachedProjectSlug,
  type OfflineBundle,
} from "../portal/offline-cache.ts"
import { fetchOfflineDiskBundle } from "../portal/disk-cache-fetch.ts"

let activeProject: string | undefined

export function portalProjectSlug() {
  const fromUrl = new URLSearchParams(location.search).get("project")
  if (fromUrl) return fromUrl
  if (import.meta.env.VITE_GATEHOUSE_PROJECT_SLUG) return import.meta.env.VITE_GATEHOUSE_PROJECT_SLUG
  return activeProject
}

/** @deprecated Use portalProjectSlug — kept for transitional imports. */
export function portalProjectDirectory() {
  return portalProjectSlug()
}

export function setPortalProjectSlug(project: string) {
  activeProject = project
}

/** @deprecated Use setPortalProjectSlug */
export function setPortalProjectDirectory(project: string) {
  setPortalProjectSlug(project)
}

export async function resolvePortalBootContext(): Promise<{
  project?: string
  diskBundle?: OfflineBundle
}> {
  const explicit = portalProjectSlug()
  if (explicit) return { project: explicit }

  const response = await fetch("/portal/api/health", { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  if (response?.ok) {
    const health = (await response.json()) as { project?: string }
    if (health.project) {
      setPortalProjectSlug(health.project)
      return { project: health.project }
    }
  }

  const fromLocal = readLastCachedProjectSlug()
  if (fromLocal) return { project: fromLocal }

  const diskBundle = await fetchOfflineDiskBundle()
  const project = diskBundle?.snapshot?.project
  if (project) {
    setPortalProjectSlug(project)
    mergeOfflineBundle(project, diskBundle)
    return { project, diskBundle }
  }

  return {}
}

export async function resolvePortalProjectSlug() {
  const context = await resolvePortalBootContext()
  return context.project
}

/** @deprecated Use resolvePortalProjectSlug */
export async function resolvePortalProjectDirectory() {
  return resolvePortalProjectSlug()
}

function projectQuery(project?: string) {
  const slug = project ?? portalProjectSlug()
  if (!slug) return ""
  return `?project=${encodeURIComponent(slug)}`
}

export function snapshotUrl(project?: string) {
  return `/portal/api/snapshot${projectQuery(project)}`
}

export function eventsUrl(project?: string) {
  return `/portal/events${projectQuery(project)}`
}

export function blogUrl(project?: string) {
  return `/portal/api/blog${projectQuery(project)}`
}

export function teamStatsUrl(project?: string) {
  return `/portal/api/team-stats${projectQuery(project)}`
}

export function brandingUrl(project?: string) {
  return `/portal/api/branding${projectQuery(project)}`
}

export function displayConfigUrl(project?: string) {
  return `/portal/api/display-config${projectQuery(project)}`
}

export function offlineCacheUrl(project?: string) {
  return `/portal/api/offline-cache${projectQuery(project)}`
}

export function skillUrl(domain: string, name: string, project?: string) {
  const base = `/portal/api/skill?domain=${encodeURIComponent(domain)}&name=${encodeURIComponent(name)}`
  const slug = project ?? portalProjectSlug()
  if (!slug) return base
  return `${base}&project=${encodeURIComponent(slug)}`
}
