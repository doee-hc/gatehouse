import type { PortalBranding } from "../api/branding.ts"
import { initLocaleFromConfig } from "./i18n.ts"

let activeBranding: PortalBranding | undefined

export function applyPortalBranding(branding: PortalBranding | undefined) {
  activeBranding = branding
  initLocaleFromConfig(branding?.locale)

  if (branding?.title) {
    const titleEl = document.querySelector(".brand h1")
    if (titleEl) titleEl.textContent = branding.title
  }

  if (branding?.subtitle) {
    const subtitleEl = document.querySelector(".brand span[data-i18n='brand.subtitle']")
    if (subtitleEl) subtitleEl.textContent = branding.subtitle
  }

  if (branding?.logo_url) {
    const iconEl = document.querySelector(".brand-icon")
    if (iconEl) {
      iconEl.innerHTML = ""
      const img = document.createElement("img")
      img.src = branding.logo_url
      img.alt = branding.title ?? "logo"
      img.className = "brand-logo"
      iconEl.appendChild(img)
    }
  }

  const footer = document.getElementById("portal-footer")
  if (footer) renderPortalFooter(footer, branding)
}

export function refreshPortalBranding() {
  applyPortalBranding(activeBranding)
}

function renderPortalFooter(footer: HTMLElement, branding: PortalBranding | undefined) {
  footer.replaceChildren()
  const text = branding?.icp_text?.trim()
  if (!text) return

  const url = branding?.icp_url?.trim()
  if (url && isHttpUrl(url)) {
    const link = document.createElement("a")
    link.href = url
    link.textContent = text
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    footer.appendChild(link)
    return
  }

  footer.textContent = text
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
