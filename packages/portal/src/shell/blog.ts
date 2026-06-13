import type { BlogPost, BlogSnapshot } from "../api/types.ts"
import { localeTag, t } from "./i18n.ts"
import { renderBlogPostBody } from "./render-blog-post.ts"

let postsById = new Map<string, BlogPost>()
let blogBound = false
let blogInitialized = false
const groupOpen = new Map<string, boolean>()

export function initBlog() {
  if (blogBound) return
  blogBound = true

  const back = document.getElementById("back-to-list")
  const list = document.getElementById("blog-list")
  const header = document.querySelector(".blog-header")
  const detail = document.getElementById("post-detail")
  if (!back || !list || !detail) return

  back.addEventListener("click", () => {
    detail.classList.remove("visible", "html-article")
    const layout = document.querySelector(".blog-layout")
    if (layout instanceof HTMLElement) layout.classList.remove("blog-reading", "blog-reading-html")
    const view = document.getElementById("view-blog")
    if (view instanceof HTMLElement) view.classList.remove("blog-html-reading")
    list.style.display = "block"
    if (header instanceof HTMLElement) header.style.display = "block"
  })

  list.addEventListener("toggle", (event) => {
    const target = event.target
    if (!(target instanceof HTMLDetailsElement)) return
    const groupId = target.getAttribute("data-group-id")
    if (groupId) groupOpen.set(groupId, target.open)
  })

  list.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest("[data-post-id]")
    if (!(card instanceof HTMLElement)) return
    const postId = card.getAttribute("data-post-id")
    if (!postId) return
    openBlogPost(postId)
  })
}

export function renderBlog(blog?: BlogSnapshot) {
  const list = document.getElementById("blog-list")
  if (!list) return

  postsById = new Map()
  if (!blog || blog.groups.length === 0) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(t("empty.noBlogPosts"))}</p>`
    return
  }

  syncExpandStateFromDom(list)

  for (const group of blog.groups) {
    for (const post of group.posts) postsById.set(post.id, post)
  }

  list.innerHTML = blog.groups.map((group) => renderGroup(group)).join("")
  blogInitialized = true
}

function syncExpandStateFromDom(list: HTMLElement) {
  for (const element of list.querySelectorAll<HTMLDetailsElement>("details.blog-group[data-group-id]")) {
    const groupId = element.getAttribute("data-group-id")
    if (groupId) groupOpen.set(groupId, element.open)
  }
}

function resolveGroupOpen(group: BlogSnapshot["groups"][number]) {
  if (groupOpen.has(group.id)) return groupOpen.get(group.id)!
  if (!blogInitialized) return group.expanded
  return false
}

function groupHeading(group: BlogSnapshot["groups"][number]) {
  if (group.kind === "team-building") return t("blog.teamBuilding")
  return group.title
}

function renderGroup(group: BlogSnapshot["groups"][number]) {
  const meta =
    group.kind === "mission"
      ? [
          group.completed_at ? formatDate(group.completed_at) : "",
          t("blog.postCount", { count: group.post_count }),
        ]
          .filter(Boolean)
          .join(" · ")
      : t("blog.postCount", { count: group.post_count })

  return `<details class="blog-group" data-group-id="${escapeHtml(group.id)}" ${resolveGroupOpen(group) ? "open" : ""}>
    <summary class="blog-group-summary">
      <div class="blog-group-heading">
        <h3>${escapeHtml(groupHeading(group))}</h3>
        ${group.objective ? `<p class="blog-group-objective">${escapeHtml(group.objective)}</p>` : ""}
      </div>
      <span class="blog-group-meta">${escapeHtml(meta)}</span>
    </summary>
    <div class="blog-posts">
      ${group.posts.map((post) => renderPostPreview(post)).join("")}
    </div>
  </details>`
}

function renderPostPreview(post: BlogPost) {
  return `<article class="blog-post-preview" data-post-id="${escapeHtml(post.id)}">
    <h4>${escapeHtml(post.title)}</h4>
    <p>${escapeHtml(post.excerpt)}</p>
    <div class="blog-post-foot">
      <span class="blog-post-date">${escapeHtml(formatDate(post.updated_at))}</span>
      <span class="read-more">${escapeHtml(t("blog.readMore"))}</span>
    </div>
    <div class="source">${escapeHtml(post.path)}</div>
  </article>`
}

function openBlogPost(postId: string) {
  const post = postsById.get(postId)
  const list = document.getElementById("blog-list")
  const header = document.querySelector(".blog-header")
  const detail = document.getElementById("post-detail")
  if (!post || !list || !detail) return

  list.style.display = "none"
  if (header instanceof HTMLElement) header.style.display = "none"
  detail.classList.add("visible")
  detail.classList.toggle("html-article", post.format === "html")

  const layout = document.querySelector(".blog-layout")
  if (layout instanceof HTMLElement) {
    layout.classList.add("blog-reading")
    layout.classList.toggle("blog-reading-html", post.format === "html")
  }
  const view = document.getElementById("view-blog")
  if (view instanceof HTMLElement) view.classList.toggle("blog-html-reading", post.format === "html")

  const title = document.getElementById("detail-title")
  const meta = document.getElementById("detail-meta")
  const body = document.getElementById("detail-body")
  if (title) title.textContent = post.title
  if (meta) meta.textContent = `${formatDate(post.updated_at)} · ${post.path}`
  if (body) renderBlogPostBody(body, post)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(localeTag(), { year: "numeric", month: "short", day: "numeric" })
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
