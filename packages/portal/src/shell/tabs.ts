export type PortalView = "office" | "blog" | "knowledge" | "stats" | "about"

const listeners = new Set<(view: PortalView) => void>()

export function onViewChange(fn: (view: PortalView) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function switchView(view: PortalView) {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-view") === view)
  })
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`)
  })
  for (const fn of listeners) fn(view)
}

export function initTabs() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.getAttribute("data-view") as PortalView | null
      if (!view) return
      switchView(view)
    })
  })
}
