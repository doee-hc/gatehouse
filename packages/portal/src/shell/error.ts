import { portalProjectDirectory } from "../api/project-directory.ts"
import { t } from "./i18n.ts"

export function showPortalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const directory = portalProjectDirectory()
  document.body.classList.add("portal-boot-failed")
  const overlay = document.createElement("div")
  overlay.className = "portal-error-overlay"
  overlay.innerHTML = `<div class="portal-error-card">
    <h2>${escapeHtml(t("error.title"))}</h2>
    <p class="portal-error-message">${escapeHtml(message)}</p>
    ${directory ? `<p class="portal-error-meta">${escapeHtml(t("error.projectDir"))}<code>${escapeHtml(directory)}</code></p>` : ""}
    <ul class="portal-error-hints">
      <li>${t("error.hint1")}</li>
      <li>${t("error.hint2")}</li>
      <li>${t("error.hint3")}</li>
      <li>${t("error.hint4")}</li>
    </ul>
  </div>`
  document.body.appendChild(overlay)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
