import { brandingUrl, portalProjectSlug } from "./project-directory.ts"

export type PortalBranding = {
  locale?: "zh" | "en"
  title?: string
  subtitle?: string
  logo_url?: string
  icp_text?: string
  icp_url?: string
}

export async function loadPortalBranding(project: string) {
  const response = await fetch(brandingUrl(project), { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json()) as PortalBranding
}

export async function fetchPortalBranding() {
  const project = portalProjectSlug()
  if (!project) return undefined
  return loadPortalBranding(project)
}
