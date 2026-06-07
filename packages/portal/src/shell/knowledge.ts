import { loadSkillDetail } from "../api/skill.ts"
import type { PortalSkill, PortalSnapshot } from "../api/types.ts"
import { getPortalSnapshot } from "../portal/state.ts"
import { renderMarkdown } from "./markdown.ts"
import { t } from "./i18n.ts"

let knowledgeBound = false
let listVisible = true

export function initKnowledge() {
  if (knowledgeBound) return
  knowledgeBound = true

  const back = document.getElementById("back-to-skills")
  const searchBtn = document.getElementById("kb-search-btn")
  const searchInput = document.getElementById("kb-search")
  const list = document.getElementById("skill-list")

  back?.addEventListener("click", () => showSkillList())

  searchBtn?.addEventListener("click", () => applySkillSearch())
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applySkillSearch()
  })

  list?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest("[data-skill-domain][data-skill-name]")
    if (!(card instanceof HTMLElement)) return
    const domain = card.getAttribute("data-skill-domain")
    const name = card.getAttribute("data-skill-name")
    if (!domain || !name) return
    void openSkill(domain, name)
  })

  list?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const card = target.closest("[data-skill-domain][data-skill-name]")
    if (!(card instanceof HTMLElement)) return
    const domain = card.getAttribute("data-skill-domain")
    const name = card.getAttribute("data-skill-name")
    if (!domain || !name) return
    void openSkill(domain, name)
  })
}

export function renderKnowledge(snapshot: PortalSnapshot) {
  if (document.getElementById("skill-detail")?.classList.contains("visible")) return
  const query = searchQuery()
  renderSkillList(filterSkills(snapshot.skills, query), query)
}

function applySkillSearch() {
  const snapshot = getPortalSnapshot()
  if (!snapshot) return
  const query = searchQuery()
  renderSkillList(filterSkills(snapshot.skills, query), query)
}

function searchQuery() {
  return (document.getElementById("kb-search") as HTMLInputElement | null)?.value.trim().toLowerCase() ?? ""
}

function filterSkills(skills: PortalSkill[], query: string) {
  if (!query) return skills
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      skill.domain.toLowerCase().includes(query) ||
      skill.path.toLowerCase().includes(query),
  )
}

function renderSkillList(skills: PortalSkill[], query: string) {
  const list = document.getElementById("skill-list")
  if (!list) return
  list.innerHTML =
    skills.length > 0
      ? skills.map((skill) => renderSkillCard(skill)).join("")
      : `<p class="empty-state">${escapeHtml(t(query ? "empty.noSearchResults" : "empty.noSkillsKb"))}</p>`
  if (listVisible) list.style.display = "grid"
}

function renderSkillCard(skill: PortalSkill) {
  return `<article class="result-card skill-card" data-skill-domain="${escapeHtml(skill.domain)}" data-skill-name="${escapeHtml(skill.name)}" role="button" tabindex="0">
    <h4>${escapeHtml(skill.name)}</h4>
    <p>${escapeHtml(skill.domain)}</p>
    <div class="source">${escapeHtml(skill.path)}</div>
    <span class="read-more">${escapeHtml(t("knowledge.viewSkill"))}</span>
  </article>`
}

async function openSkill(domain: string, name: string) {
  const snapshot = getPortalSnapshot()
  const header = document.querySelector(".knowledge-header")
  const searchBox = document.querySelector("#view-knowledge .search-box")
  const list = document.getElementById("skill-list")
  const detail = document.getElementById("skill-detail")
  const title = document.getElementById("skill-detail-title")
  const meta = document.getElementById("skill-detail-meta")
  const body = document.getElementById("skill-detail-body")
  if (!list || !detail || !title || !meta || !body) return

  listVisible = false
  list.style.display = "none"
  if (header instanceof HTMLElement) header.style.display = "none"
  if (searchBox instanceof HTMLElement) searchBox.style.display = "none"
  detail.classList.add("visible")
  title.textContent = name
  meta.textContent = `${domain} · ${pathForSkill(domain, name)}`
  body.innerHTML = `<p class="empty-state">${escapeHtml(t("knowledge.loading"))}</p>`

  const detailData = await loadSkillDetail(domain, name, snapshot?.project).catch(() => undefined)
  if (!detailData) {
    body.innerHTML = `<p class="empty-state">${escapeHtml(t("knowledge.loadFailed"))}</p>`
    return
  }
  title.textContent = detailData.name
  meta.textContent = `${detailData.domain} · ${detailData.path}`
  body.innerHTML = renderMarkdown(detailData.markdown)
}

function showSkillList() {
  const header = document.querySelector(".knowledge-header")
  const searchBox = document.querySelector("#view-knowledge .search-box")
  const list = document.getElementById("skill-list")
  const detail = document.getElementById("skill-detail")
  if (!list || !detail) return

  listVisible = true
  detail.classList.remove("visible")
  list.style.display = "grid"
  if (header instanceof HTMLElement) header.style.display = "block"
  if (searchBox instanceof HTMLElement) searchBox.style.display = "flex"
}

function pathForSkill(domain: string, name: string) {
  return `.gatehouse/skills/by-domain/${domain}/${name}/SKILL.md`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
