export type Locale = "zh" | "en"

const STORAGE_KEY = "gatehouse/portal-locale"

const messages = {
  "brand.subtitle": { zh: "团队门户", en: "Team Portal" },

  "nav.office": { zh: "🏢 办公室", en: "🏢 Office" },
  "nav.blog": { zh: "📝 博客", en: "📝 Blog" },
  "nav.knowledge": { zh: "📚 SKILLs", en: "📚 SKILLs" },
  "nav.stats": { zh: "📊 团队数据", en: "📊 Team Stats" },
  "nav.about": { zh: "ℹ️ 关于", en: "ℹ️ About" },
  "nav.loading": { zh: "加载中…", en: "Loading…" },
  "nav.connecting": { zh: "连接 Portal API…", en: "Connecting to Portal API…" },
  "nav.waitingApi": { zh: "等待 Portal API ({attempt}/{max})…", en: "Waiting for Portal API ({attempt}/{max})…" },
  "nav.connected": { zh: "已连接", en: "Connected" },
  "nav.project": { zh: "项目：{name}", en: "Project: {name}" },

  "esc.mission": { zh: "任务 · {id}", en: "Mission · {id}" },
  "esc.missionEmpty": { zh: "任务 · —", en: "Mission · —" },
  "esc.missionLingering": { zh: "待命 · {id}", en: "Standby · {id}" },
  "esc.status.live": { zh: "● LIVE", en: "● LIVE" },
  "esc.status.idle": { zh: "● 待命", en: "● Standby" },
  "esc.status.connected": { zh: "● 已连接", en: "● Connected" },

  "office.renovating": { zh: "正在装修中…", en: "Renovating the office…" },

  "panel.selectedAgent": { zh: "选中 Agent", en: "Selected Agent" },
  "panel.missions": { zh: "任务", en: "Missions" },
  "panel.execTree": { zh: "执行团队", en: "Execution team" },
  "panel.skills": { zh: "领域技能", en: "Domain Skills" },
  "panel.events": { zh: "事件流", en: "Event Log" },

  "empty.noMissions": { zh: "暂无任务数据", en: "No missions yet" },
  "empty.execTreeArchived": { zh: "任务已结束，执行团队已归档", en: "Mission ended; execution team archived" },
  "empty.noExecTreeForMission": { zh: "当前任务暂无执行团队", en: "No execution team for current mission" },
  "empty.noExecTree": { zh: "暂无执行团队数据", en: "No execution team data" },
  "empty.noSkills": { zh: "暂无领域技能数据", en: "No domain skills yet" },
  "empty.quietOffice": { zh: "办公室安静中，暂无新事件", en: "Office is quiet — no new events" },
  "empty.quietOfficeLingering": {
    zh: "待命期间，上一轮执行团队仍在办公室",
    en: "Between missions — the last execution team is still in the office",
  },
  "empty.waitingEvents": { zh: "等待 OpenCode 事件…", en: "Waiting for OpenCode events…" },
  "empty.opencodeOffline": {
    zh: "OpenCode 未连接 — 请运行 bun run dev <项目目录> 启动完整栈",
    en: "OpenCode offline — run bun run dev <project> to start the full stack",
  },
  "event.portalStreamReady": { zh: "Portal 事件流已连接", en: "Portal event stream connected" },
  "event.opencodeConnected": { zh: "OpenCode 已连接", en: "OpenCode connected" },
  "event.opencodeDisconnected": {
    zh: "OpenCode 未连接 — agent 状态无法同步",
    en: "OpenCode offline — agent status cannot sync",
  },
  "event.agentStatus": { zh: "{name} → {to}", en: "{name} → {to}" },
  "event.sessionBusy": { zh: "{name} 开始工作", en: "{name} started working" },
  "event.sessionIdle": { zh: "{name} 空闲", en: "{name} idle" },
  "event.sessionResearch": { zh: "{name} 阅读 Skill", en: "{name} reading skills" },
  "event.agentChat": { zh: "{from} → {to}：{text}", en: "{from} → {to}: {text}" },
  "empty.noSkillDomains": { zh: "暂无 skill 领域", en: "No skill domains yet" },
  "empty.noSkillsKb": { zh: "暂无 skill", en: "No skills yet" },
  "empty.ragNotConnected": { zh: "WeKnora RAG 尚未接入", en: "WeKnora RAG not connected yet" },
  "empty.noBlogPosts": { zh: "暂无博客文章", en: "No blog posts yet" },
  "empty.noSearchResults": { zh: "未找到匹配的 skill", en: "No matching skills found" },

  "mission.running": { zh: "进行中", en: "Running" },
  "mission.retro": { zh: "复盘中", en: "Retro" },
  "mission.queued": { zh: "排队", en: "Queued" },
  "mission.done": { zh: "已完成", en: "Done" },

  "agent.idle": { zh: "空闲", en: "IDLE" },
  "agent.busy": { zh: "忙碌", en: "BUSY" },
  "agent.blocked": { zh: "阻塞", en: "BLOCKED" },
  "agent.research": { zh: "阅读", en: "READ" },
  "agent.description": { zh: "描述", en: "Description" },
  "agent.skills": { zh: "技能", en: "Skills" },

  "outer.lead.description": {
    zh: "统筹任务从规划到交付、收尾：结合长期方向选定当前要做的任务，与你一起敲定目标、细节和约束；启动任务后跟进交付，与你确认达到标准后正式结束任务。",
    en: "Owns the full task lifecycle: picks what to do now based on long-term direction, aligns with you on goals, details, and constraints; starts the work and tracks delivery; closes the task once you agree it meets the bar.",
  },
  "outer.architect.description": {
    zh: "管理团队的组织方式：按任务特点搭一支能高效协作的执行队伍，任务结束后队伍解散；通过复盘看执行效率与成本，持续改进更适合该类任务的团队结构。",
    en: "Designs how the team is organized: builds an efficient execution group for each task's needs, then disbands it when the task ends; reviews speed and cost in retros and keeps refining structures that fit that kind of work.",
  },
  "outer.curator.description": {
    zh: "维护各领域的技能资料：任务开始前为每位执行者分配合适的领域技能；任务复盘时把执行者更新过的技能整理归档，供后续任务复用。",
    en: "Maintains domain skill materials: assigns the right domain skills to each executor before a task starts; after retro, archives skill updates from executors for reuse on later tasks.",
  },
  "outer.arbiter.description": {
    zh: "独立的权限审批人：按规则处理团队成员的权限申请，自动给出放行或拒绝，并完整记录每一次决定。",
    en: "Independent permission reviewer: handles team permission requests by policy, approves or denies automatically, and logs every outcome.",
  },

  "sidebar.noNodeId": { zh: "无 node_id", en: "No node_id" },
  "sidebar.node": { zh: "node · {id}", en: "node · {id}" },

  "blog.title": { zh: "团队博客", en: "Team Blog" },
  "blog.subtitle": { zh: "由 Agent 发布的复盘摘要与 Mission 叙事", en: "Retrospectives and mission narratives from Agents" },
  "blog.back": { zh: "← 返回列表", en: "← Back to list" },
  "blog.readMore": { zh: "阅读全文 →", en: "Read full post →" },
  "blog.reportCount": { zh: "{count} 篇报告", en: "{count} report{s}" },
  "blog.postCount": { zh: "{count} 篇", en: "{count} post{s}" },
  "blog.teamBuilding": { zh: "团队建设", en: "Team building" },

  "knowledge.title": { zh: "SKILLs", en: "SKILLs" },
  "knowledge.subtitle": { zh: "团队 Skill 目录", en: "Team skill catalog" },
  "knowledge.searchPlaceholder": { zh: "搜索 skill…", en: "Search skills…" },
  "knowledge.searchBtn": { zh: "搜索", en: "Search" },
  "knowledge.back": { zh: "← 返回列表", en: "← Back to list" },
  "knowledge.viewSkill": { zh: "查看全文 →", en: "View full skill →" },
  "knowledge.loading": { zh: "加载中…", en: "Loading…" },
  "knowledge.loadFailed": { zh: "无法加载 skill 内容", en: "Failed to load skill content" },

  "stats.title": { zh: "团队数据", en: "Team Stats" },
  "stats.subtitle": {
    zh: "各 Mission 的 token、cost、耗时与 Inner 角色分布",
    en: "Token, cost, duration per mission and inner role breakdown",
  },
  "stats.loading": { zh: "加载统计数据…", en: "Loading stats…" },
  "stats.empty": { zh: "暂无统计数据", en: "No stats yet" },
  "stats.loadFailed": { zh: "无法加载团队数据", en: "Failed to load team stats" },
  "stats.updatedAt": { zh: "更新于 {time}", en: "Updated {time}" },
  "stats.outerTitle": { zh: "Outer 总览", en: "Outer overview" },
  "stats.outerSubtitle": {
    zh: "核心团队角色（Lead / Architect / Curator / Arbiter）累计消耗",
    en: "Project-level outer agents (Lead / Architect / Curator / Arbiter)",
  },
  "stats.missionTitle": { zh: "Mission 对比", en: "Mission comparison" },
  "stats.missionSubtitle": {
    zh: "各 Mission 执行团队成员累计消耗",
    en: "Execution team member totals per mission",
  },
  "stats.detailTitle": { zh: "Mission 明细", en: "Mission details" },
  "stats.detailSubtitle": { zh: "点击卡片展开 Inner 角色 token 分布", en: "Click a card to expand inner role token breakdown" },
  "stats.chartTokens": { zh: "Token", en: "Tokens" },
  "stats.chartCost": { zh: "Cost", en: "Cost" },
  "stats.chartDuration": { zh: "耗时", en: "Duration" },
  "stats.totalCost": { zh: "总 Cost", en: "Total cost" },
  "stats.totalDuration": { zh: "总耗时", en: "Total duration" },
  "stats.metricTokens": { zh: "Token", en: "Tokens" },
  "stats.metricCost": { zh: "Cost", en: "Cost" },
  "stats.metricDuration": { zh: "Agent 耗时", en: "Agent time" },
  "stats.metricWallClock": { zh: "墙钟时间", en: "Wall clock" },
  "stats.roleTokens": { zh: "Inner 角色 Token", en: "Inner role tokens" },
  "stats.noRoles": { zh: "该 Mission 暂无执行团队成员", en: "No execution team members for this mission" },
  "stats.expand": { zh: "展开角色分布 →", en: "Expand role breakdown →" },
  "stats.ticker": { zh: "Token {tokens} · {cost}", en: "Tokens {tokens} · {cost}" },

  "toast.bulletinToBlog": { zh: "公告栏 → 跳转到博客", en: "Bulletin board → Blog" },
  "toast.searchKeyword": { zh: "请输入搜索关键词", en: "Enter a search keyword" },

  "tree.coordinator": { zh: "(协调员)", en: "(coordinator)" },
  "tree.oneNode": { zh: "1 节点", en: "1 node" },
  "tree.nodeCount": { zh: "{count} 节点", en: "{count} nodes" },
  "tree.exec": { zh: "EXEC · {label}", en: "EXEC · {label}" },

  "zone.hq": { zh: "HQ · 核心团队", en: "HQ · Core team" },
  "zone.missionWing": { zh: "任务区", en: "MISSION WING" },
  "zone.common": { zh: "公共区", en: "Common Area" },
  "zone.office": { zh: "办公室", en: "Office" },

  "map.label": { zh: "地图", en: "MAP" },

  "error.title": { zh: "Portal 加载失败", en: "Portal failed to load" },
  "error.noProjectDir": {
    zh: "未指定项目目录。请使用 bun run dev /path/to/project 启动。",
    en: "No project directory specified. Start with: bun run dev /path/to/project",
  },
  "error.projectDir": { zh: "项目目录：", en: "Project directory:" },
  "error.hint1": {
    zh: "请使用 <code>bun run dev /path/to/project</code> 启动 OpenCode 与 Portal",
    en: "Start OpenCode and Portal with <code>bun run dev /path/to/project</code>",
  },
  "error.hint2": {
    zh: "确认 OpenCode 已加载 <code>@gatehouse/core</code> 插件（终端应出现 <code>[gatehouse/portal] API</code> 日志）",
    en: "Ensure OpenCode loaded the <code>@gatehouse/core</code> plugin (look for <code>[gatehouse/portal] API</code> in the terminal)",
  },
  "error.hint3": {
    zh: "若 18471 端口被僵尸进程占用：<code>fuser -k 18471/tcp</code>",
    en: "If port 18471 is held by a stale process: <code>fuser -k 18471/tcp</code>",
  },
  "error.hint4": {
    zh: "若使用了 HTTP 代理，本地请求可能被拦截——请用 <code>bun run dev /path/to/project</code> 启动（已自动绕过代理）",
    en: "HTTP proxies may block local requests — use <code>bun run dev /path/to/project</code> (proxy bypass is automatic)",
  },

  "assets.loadFailed": {
    zh: "办公室资源加载失败\n请运行: GATEHOUSE_PROJECT_DIR=/path/to/project bun run import:office-layout",
    en: "Office assets failed to load\nRun: GATEHOUSE_PROJECT_DIR=/path/to/project bun run import:office-layout",
  },
  "assets.tilesetFailed": { zh: "地图 tileset 绑定失败", en: "Map tileset binding failed" },

  "about.title": { zh: "关于与致谢", en: "About & Credits" },
  "about.subtitle": {
    zh: "Gatehouse 项目介绍与开源仓库。",
    en: "Gatehouse overview and open-source repository.",
  },
  "about.projectTitle": { zh: "项目介绍", en: "About Gatehouse" },
  "about.projectDesc": {
    zh: "Gatehouse 是一款基于 <a href=\"https://opencode.ai\" target=\"_blank\" rel=\"noopener noreferrer\">OpenCode</a> 的自我迭代多智能体团队插件：角色分工协作、Mission 全生命周期管理，以及可视化的 Portal 像素办公室。复盘与技能沉淀会反哺后续任务，让团队能力随项目演进。",
    en: "Gatehouse is a self-improving multi-agent team plugin for <a href=\"https://opencode.ai\" target=\"_blank\" rel=\"noopener noreferrer\">OpenCode</a> — role-based collaboration, Mission lifecycle management, and a visual Portal pixel office. Retrospectives and skill distillation feed back into future missions as the team evolves with your project.",
  },
  "about.projectNote": {
    zh: "项目仍处于早期开发阶段，功能可能变更或不完整，请自行评估风险。",
    en: "The project is in early development; features may change or be incomplete. Use at your own risk.",
  },
  "about.githubLabel": { zh: "GitHub 仓库", en: "GitHub repository" },
  "about.artCredit": {
    zh: "Portal 办公室的像素美术素材来自 <a href=\"https://limezu.itch.io/\" target=\"_blank\" rel=\"noopener noreferrer\">LimeZu</a>，感谢作者的精彩创作。",
    en: "Portal office pixel art is sourced from <a href=\"https://limezu.itch.io/\" target=\"_blank\" rel=\"noopener noreferrer\">LimeZu</a> — thank you for the wonderful work.",
  },
} as const

export type MessageKey = keyof typeof messages

const listeners = new Set<() => void>()

let locale: Locale = readStoredLocale()

export const PHASER_FONT = '"Noto Sans SC", sans-serif'

const OFFICE_GAME_WIDTH = 768
const OFFICE_GAME_HEIGHT = 512

/** Oversample Phaser Text for FIT CSS upscale + devicePixelRatio. */
export function phaserTextResolution() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const parent = document.getElementById("office-game")
  if (!parent?.clientWidth) return Math.max(3, Math.ceil(dpr * 2))
  const fitScale = Math.min(parent.clientWidth / OFFICE_GAME_WIDTH, parent.clientHeight / OFFICE_GAME_HEIGHT)
  return Math.max(3, Math.ceil(dpr * fitScale))
}

export function getLocale() {
  return locale
}

export function initLocaleFromConfig(configLocale?: Locale) {
  if (localStorage.getItem(STORAGE_KEY)) return
  if (configLocale === "zh" || configLocale === "en") setLocale(configLocale)
}

export function setLocale(next: Locale) {
  if (next === locale) return
  locale = next
  localStorage.setItem(STORAGE_KEY, next)
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en"
  for (const fn of listeners) fn()
}

export function onLocaleChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key: MessageKey, params?: Record<string, string | number>) {
  let text: string = messages[key][locale]
  if (!params) return text
  if ("count" in params && text.includes("{s}")) {
    const count = Number(params.count)
    text = text.replace("{s}", count === 1 ? "" : "s")
  }
  for (const [name, value] of Object.entries(params)) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}

const OUTER_PROFILES = ["lead", "architect", "curator", "arbiter"] as const

function isOuterProfile(profile: string): profile is (typeof OUTER_PROFILES)[number] {
  return (OUTER_PROFILES as readonly string[]).includes(profile)
}

/** Portal agent detail: fixed bilingual copy for the four outer roles; others use snapshot text. */
export function agentDetailDescription(input: { scope: string; profile: string; description?: string }) {
  if (input.scope === "outer" && isOuterProfile(input.profile)) {
    return t(`outer.${input.profile}.description`)
  }
  return input.description
}

export function agentStatusLabel(status: string) {
  if (status === "busy") return t("agent.busy")
  if (status === "research") return t("agent.research")
  if (status === "blocked") return t("agent.blocked")
  return t("agent.idle")
}

export function missionStatusLabel(status: string) {
  if (status === "running") return t("mission.running")
  if (status === "retro") return t("mission.retro")
  if (status === "queued") return t("mission.queued")
  if (status === "done" || status === "completed") return t("mission.done")
  return status
}

export function localeTag() {
  return locale === "zh" ? "zh-CN" : "en"
}

export function applyStaticLabels() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n") as MessageKey | null
    if (key) el.textContent = t(key)
  })
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html") as MessageKey | null
    if (key) el.innerHTML = t(key)
  })
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder") as MessageKey | null
    if (key && el instanceof HTMLInputElement) el.placeholder = t(key)
  })
}

function updateLocaleToggle() {
  const current = getLocale()
  document.querySelectorAll(".locale-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-locale") === current)
  })
}

export function initI18n(onChange: () => void) {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"
  applyStaticLabels()
  document.querySelectorAll(".locale-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-locale")
      if (next === "zh" || next === "en") setLocale(next)
    })
  })
  onLocaleChange(() => {
    applyStaticLabels()
    updateLocaleToggle()
    onChange()
  })
  updateLocaleToggle()
}

function readStoredLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "zh" || stored === "en") return stored
  return navigator.language.startsWith("zh") ? "zh" : "en"
}
