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

export async function resolvePortalProjectSlug() {
  const explicit = portalProjectSlug()
  if (explicit) return explicit

  const response = await fetch("/portal/api/health", { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  if (!response?.ok) return undefined
  const health = (await response.json()) as { project?: string }
  if (health.project) setPortalProjectSlug(health.project)
  return health.project
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

export function skillUrl(domain: string, name: string, project?: string) {
  const base = `/portal/api/skill?domain=${encodeURIComponent(domain)}&name=${encodeURIComponent(name)}`
  const slug = project ?? portalProjectSlug()
  if (!slug) return base
  return `${base}&project=${encodeURIComponent(slug)}`
}
