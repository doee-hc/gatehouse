let activeDirectory: string | undefined

export function portalProjectDirectory() {
  const fromUrl = new URLSearchParams(location.search).get("directory")
  if (fromUrl) return fromUrl
  if (import.meta.env.VITE_GATEHOUSE_PROJECT_DIR) return import.meta.env.VITE_GATEHOUSE_PROJECT_DIR
  return activeDirectory
}

export function setPortalProjectDirectory(directory: string) {
  activeDirectory = directory
}

export async function resolvePortalProjectDirectory() {
  const explicit = portalProjectDirectory()
  if (explicit) return explicit

  const response = await fetch("/portal/api/health", { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  if (!response?.ok) return undefined
  const health = (await response.json()) as { project_directory?: string; default_project_directory?: string }
  const directory = health.default_project_directory ?? health.project_directory
  if (directory) setPortalProjectDirectory(directory)
  return directory
}

function snapshotQuery(directory?: string) {
  if (!directory) return "/portal/api/snapshot"
  return `/portal/api/snapshot?directory=${encodeURIComponent(directory)}`
}

export function snapshotUrl(directory?: string) {
  return snapshotQuery(directory ?? portalProjectDirectory())
}

export function eventsUrl(directory?: string) {
  const dir = directory ?? portalProjectDirectory()
  if (!dir) return "/portal/events"
  return `/portal/events?directory=${encodeURIComponent(dir)}`
}
