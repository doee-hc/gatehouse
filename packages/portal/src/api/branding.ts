import { portalProjectDirectory } from "./project-directory.ts"

export type PortalBranding = {
  locale?: "zh" | "en"
  title?: string
  subtitle?: string
  logo_url?: string
  icp_text?: string
  icp_url?: string
}

function brandingUrl(directory: string) {
  return `/portal/api/branding?directory=${encodeURIComponent(directory)}`
}

export async function loadPortalBranding(directory: string) {
  const response = await fetch(brandingUrl(directory), { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json()) as PortalBranding
}

export async function fetchPortalBranding() {
  const directory = portalProjectDirectory()
  if (!directory) return undefined
  return loadPortalBranding(directory)
}
