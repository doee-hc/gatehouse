import type { BlogPost } from "../api/types.ts"
import { t } from "./i18n.ts"
import { renderBlogPostBody } from "./render-blog-post.ts"

let overlayKeyHandler: ((event: KeyboardEvent) => void) | undefined

export function openBlogHtmlOverlay(post: BlogPost) {
  let overlay = document.getElementById("blog-html-overlay")
  if (!overlay) {
    overlay = document.createElement("div")
    overlay.id = "blog-html-overlay"
    overlay.className = "blog-html-overlay"
    overlay.hidden = true
    overlay.innerHTML = `<div class="blog-html-overlay-backdrop" data-blog-html-close></div>
      <div class="blog-html-overlay-panel" role="dialog" aria-modal="true">
        <button type="button" class="blog-html-overlay-close" data-blog-html-close aria-label="${escapeAttr(t("orch.close"))}">×</button>
        <div class="blog-html-overlay-body"></div>
      </div>`
    document.body.appendChild(overlay)
    overlay.querySelectorAll("[data-blog-html-close]").forEach((el) => {
      el.addEventListener("click", () => closeBlogHtmlOverlay())
    })
  }

  const panel = overlay.querySelector(".blog-html-overlay-panel")
  const body = overlay.querySelector(".blog-html-overlay-body")
  if (panel) panel.setAttribute("aria-label", post.title)
  if (body instanceof HTMLElement) renderBlogPostBody(body, post)

  overlay.hidden = false
  document.body.classList.add("blog-html-overlay-open")

  if (!overlayKeyHandler) {
    overlayKeyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeBlogHtmlOverlay()
    }
    document.addEventListener("keydown", overlayKeyHandler)
  }
}

export function closeBlogHtmlOverlay() {
  const overlay = document.getElementById("blog-html-overlay")
  if (!overlay) return
  overlay.hidden = true
  document.body.classList.remove("blog-html-overlay-open")
  const body = overlay.querySelector(".blog-html-overlay-body")
  if (body instanceof HTMLElement) body.replaceChildren()
}

function escapeAttr(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
}
