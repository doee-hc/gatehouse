import { existsSync } from "node:fs"
import path from "node:path"
import { isAllowedLogoPath, loadGatehouseConfig } from "../gatehouse-config.ts"
import { resolvePortalProjectSlug } from "./portal-project.ts"

export type PortalBrandingResponse = {
  locale?: string
  title?: string
  subtitle?: string
  logo_url?: string
  icp_text?: string
  icp_url?: string
}

export function buildPortalBranding(projectDirectory: string, requestUrl: URL) {
  const config = loadGatehouseConfig(projectDirectory)
  const brand = config.portal.brand
  const response: PortalBrandingResponse = { locale: config.locale }

  if (brand.title) response.title = brand.title
  if (brand.subtitle) response.subtitle = brand.subtitle
  if (brand.icp_text) response.icp_text = brand.icp_text
  if (brand.icp_url) response.icp_url = brand.icp_url

  const logoPath = brand.logo_path
  if (logoPath && existsSync(logoPath) && isAllowedLogoPath(logoPath, projectDirectory)) {
    const project = encodeURIComponent(resolvePortalProjectSlug(projectDirectory))
    // Relative URL keeps logo loading through the same origin (Vite proxy or bundled Portal UI).
    response.logo_url = `/portal/api/branding/logo?project=${project}`
  }

  return response
}

export function resolvePortalLogoFile(projectDirectory: string) {
  const logoPath = loadGatehouseConfig(projectDirectory).portal.brand.logo_path
  if (!logoPath || !existsSync(logoPath)) return
  if (!isAllowedLogoPath(logoPath, projectDirectory)) return
  return path.resolve(logoPath)
}
