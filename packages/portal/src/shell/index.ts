import type { PortalSnapshot } from "../api/types.ts"
import "./portal.css"
import { refreshOfficeSceneLocale } from "../office/game.ts"
import { getBlogSnapshot, getPortalSnapshot } from "../portal/state.ts"
import { bindAgentOverlay, refreshAgentOverlay } from "./agent-overlay.ts"
import { initBlog, renderBlog } from "./blog.ts"
import { refreshPortalBranding } from "./branding.ts"
import { refreshEventLog } from "./event-log.ts"
import { initI18n } from "./i18n.ts"
import { initKnowledge } from "./knowledge.ts"
import { initTeamStats, refreshTeamStats, renderTeamStats } from "./team-stats.ts"
import { bindOfficeSidebar } from "./office-sidebar.ts"
import { renderPortal } from "./render-portal.ts"
import { initTabs, onViewChange } from "./tabs.ts"
import { showToast } from "./toast.ts"

export function initShell(onOfficeReady: () => void, snapshot: PortalSnapshot) {
  initI18n(() => {
    const current = getPortalSnapshot()
    if (current) renderPortal(current)
    refreshEventLog()
    renderBlog(getBlogSnapshot())
    renderTeamStats()
    refreshOfficeSceneLocale()
    refreshAgentOverlay()
    refreshPortalBranding()
  })

  initTabs()
  initBlog()
  initKnowledge()
  initTeamStats()
  bindOfficeSidebar()
  bindAgentOverlay()
  renderPortal(snapshot)

  onViewChange((view) => {
    if (view === "office") onOfficeReady()
    if (view === "stats") void refreshTeamStats()
  })

  if (document.getElementById("view-office")?.classList.contains("active")) onOfficeReady()

  return { showToast }
}
