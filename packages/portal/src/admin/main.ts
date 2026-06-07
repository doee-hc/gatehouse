import "./admin.css"
import QRCode from "qrcode"
import { initI18n, t } from "../shell/i18n.ts"
import {
  cancelWeixinLogin,
  clearAdminToken,
  createAdminSession,
  fetchAdminStatus,
  fetchChannelsSnapshot,
  getAdminToken,
  pollWeixinLogin,
  setAdminToken,
  startSupervisor,
  startWeixinLogin,
  stopSupervisor,
  type ChannelAdminSnapshot,
  type WeixinLoginSession,
} from "./api.ts"

const gate = document.getElementById("admin-gate")!
const gateError = document.getElementById("admin-gate-error")!
const gateStatus = document.getElementById("admin-gate-status")!
const main = document.getElementById("admin-main")!
const logoutBtn = document.getElementById("admin-logout")!
const loginForm = document.getElementById("admin-login-form") as HTMLFormElement
const keyInput = document.getElementById("admin-key-input") as HTMLInputElement
const supervisorStatus = document.getElementById("supervisor-status")!
const channelList = document.getElementById("channel-list")!
const weixinStatus = document.getElementById("weixin-login-status")!
const weixinQrHost = document.getElementById("weixin-qr-host")!
const weixinStartBtn = document.getElementById("weixin-login-start") as HTMLButtonElement
const weixinCancelBtn = document.getElementById("weixin-login-cancel") as HTMLButtonElement
const supervisorStartBtn = document.getElementById("supervisor-start") as HTMLButtonElement
const supervisorStopBtn = document.getElementById("supervisor-stop") as HTMLButtonElement

let weixinSessionId: string | undefined
let weixinPollTimer: ReturnType<typeof setInterval> | undefined
let lastChannelSnapshot: ChannelAdminSnapshot | undefined
let lastSupervisorMessage: string | undefined
let lastWeixinSession: WeixinLoginSession | undefined
let weixinStatusIsDefault = true

function syncPageTitle() {
  document.title = t("admin.pageTitle")
}

function showGate(message?: string) {
  gate.hidden = false
  main.hidden = true
  logoutBtn.hidden = true
  gateError.hidden = !message
  if (message) gateError.textContent = message
}

function showMain() {
  gate.hidden = true
  main.hidden = false
  logoutBtn.hidden = false
  gateError.hidden = true
}

function formatSupervisor(snapshot: ChannelAdminSnapshot) {
  if (!snapshot.supervisor.running) return t("admin.supervisor.notRunning")
  const started = snapshot.supervisor.startedAt
    ? new Date(snapshot.supervisor.startedAt).toLocaleString()
    : "—"
  return t("admin.supervisor.running", {
    pid: snapshot.supervisor.pid ?? "—",
    started,
  })
}

function runtimeLabel(entry: ChannelAdminSnapshot["channels"][number]) {
  const parts = [
    entry.enabled ? t("admin.channels.enabled") : t("admin.channels.disabled"),
    entry.configured ? t("admin.channels.configured") : t("admin.channels.notConfigured"),
  ]
  const status = entry.runtime?.status
  if (status) parts.push(`runtime=${status}`)
  if (entry.runtime?.lastError) parts.push(entry.runtime.lastError)
  return parts.join(" · ")
}

function renderChannels(snapshot: ChannelAdminSnapshot, supervisorMessage?: string) {
  lastChannelSnapshot = snapshot
  lastSupervisorMessage = supervisorMessage
  supervisorStatus.classList.remove("admin-error")
  supervisorStatus.textContent = supervisorMessage ?? formatSupervisor(snapshot)
  channelList.innerHTML = ""

  for (const entry of snapshot.channels) {
    const card = document.createElement("div")
    card.className = "channel-card"

    const info = document.createElement("div")
    const title = document.createElement("h3")
    title.textContent = entry.id
    const meta = document.createElement("p")
    meta.className = "channel-meta"
    meta.textContent = runtimeLabel(entry)
    info.append(title, meta)

    card.append(info)
    channelList.append(card)
  }
}

async function renderWeixinQr(session: WeixinLoginSession) {
  lastWeixinSession = session
  weixinQrHost.innerHTML = ""
  const payload = session.qrContent?.trim() || session.qrToken?.trim()
  if (!payload) {
    weixinQrHost.textContent = t("admin.weixin.noQrContent")
    return
  }

  try {
    const canvas = document.createElement("canvas")
    await QRCode.toCanvas(canvas, payload, {
      width: 240,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
    weixinQrHost.append(canvas)
  } catch {
    const pre = document.createElement("pre")
    pre.textContent = payload
    weixinQrHost.append(pre)
  }

  if (/^https?:\/\//i.test(payload)) {
    const link = document.createElement("a")
    link.className = "admin-muted"
    link.href = payload
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.textContent = t("admin.weixin.openInBrowser")
    link.style.display = "block"
    link.style.marginTop = "0.5rem"
    weixinQrHost.append(link)
  }
}

function weixinPhaseText(session: WeixinLoginSession) {
  if (session.message) return session.message
  switch (session.phase) {
    case "wait":
      return t("admin.weixin.phase.wait")
    case "scaned":
      return t("admin.weixin.phase.scaned")
    case "expired":
      return t("admin.weixin.phase.expired")
    case "confirmed":
      return t("admin.weixin.phase.confirmed")
    case "failed":
      return t("admin.weixin.phase.failed")
    case "cancelled":
      return t("admin.weixin.phase.cancelled")
    default:
      return session.phase
  }
}

function setWeixinStatusText(text: string, isDefault = false) {
  weixinStatusIsDefault = isDefault
  weixinStatus.textContent = text
}

function stopWeixinPoll() {
  if (weixinPollTimer) clearInterval(weixinPollTimer)
  weixinPollTimer = undefined
}

async function refreshChannels() {
  const snapshot = await fetchChannelsSnapshot()
  renderChannels(snapshot)
}

async function pollWeixinSession() {
  if (!weixinSessionId) return
  try {
    const { session } = await pollWeixinLogin(weixinSessionId)
    setWeixinStatusText(weixinPhaseText(session))
    await renderWeixinQr(session)
    if (session.phase === "confirmed") {
      stopWeixinPoll()
      weixinCancelBtn.hidden = true
      await refreshChannels()
    }
    if (session.phase === "failed" || session.phase === "cancelled") {
      stopWeixinPoll()
      weixinSessionId = undefined
      weixinCancelBtn.hidden = true
    }
  } catch (error) {
    stopWeixinPoll()
    setWeixinStatusText(error instanceof Error ? error.message : String(error))
  }
}

function refreshAdminLocale() {
  syncPageTitle()
  if (gateStatus.textContent) {
    gateStatus.textContent = gateStatus.dataset.configured === "1"
      ? t("admin.gate.keyConfigured")
      : t("admin.gate.keyNotConfigured")
  }
  if (lastChannelSnapshot) renderChannels(lastChannelSnapshot, lastSupervisorMessage)
  if (lastWeixinSession) {
    void renderWeixinQr(lastWeixinSession)
    if (!weixinStatusIsDefault) setWeixinStatusText(weixinPhaseText(lastWeixinSession))
  } else if (weixinStatusIsDefault) {
    setWeixinStatusText(t("admin.weixin.notStarted"), true)
  }
}

async function bootAuthenticated() {
  showMain()
  await refreshChannels()
}

initI18n(refreshAdminLocale)
syncPageTitle()

loginForm.addEventListener("submit", (event) => {
  event.preventDefault()
  void (async () => {
    gateError.hidden = true
    try {
      const { token } = await createAdminSession(keyInput.value)
      setAdminToken(token)
      keyInput.value = ""
      await bootAuthenticated()
    } catch (error) {
      showGate(error instanceof Error ? error.message : String(error))
    }
  })()
})

logoutBtn.addEventListener("click", () => {
  clearAdminToken()
  stopWeixinPoll()
  showGate()
})

document.getElementById("channels-refresh")!.addEventListener("click", () => {
  void refreshChannels().catch((error) => alert(error instanceof Error ? error.message : String(error)))
})

supervisorStartBtn.addEventListener("click", () => {
  void (async () => {
    supervisorStartBtn.disabled = true
    supervisorStatus.classList.remove("admin-error")
    supervisorStatus.textContent = t("admin.supervisor.starting")
    try {
      const result = await startSupervisor()
      renderChannels(result.snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      supervisorStatus.classList.add("admin-error")
      supervisorStatus.textContent = message
      lastSupervisorMessage = message
    } finally {
      supervisorStartBtn.disabled = false
    }
  })()
})

supervisorStopBtn.addEventListener("click", () => {
  void (async () => {
    supervisorStopBtn.disabled = true
    try {
      const result = await stopSupervisor()
      renderChannels(result.snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      supervisorStatus.classList.add("admin-error")
      supervisorStatus.textContent = message
      lastSupervisorMessage = message
    } finally {
      supervisorStopBtn.disabled = false
    }
  })()
})

weixinStartBtn.addEventListener("click", () => {
  void (async () => {
    stopWeixinPoll()
    weixinQrHost.innerHTML = ""
    lastWeixinSession = undefined
    setWeixinStatusText(t("admin.weixin.fetchingQr"))
    weixinStartBtn.disabled = true
    try {
      const { session } = await startWeixinLogin()
      weixinSessionId = session.id
      weixinCancelBtn.hidden = false
      setWeixinStatusText(weixinPhaseText(session))
      await renderWeixinQr(session)
      weixinPollTimer = setInterval(() => {
        void pollWeixinSession()
      }, 1500)
      void pollWeixinSession()
    } catch (error) {
      setWeixinStatusText(error instanceof Error ? error.message : String(error))
    } finally {
      weixinStartBtn.disabled = false
    }
  })()
})

weixinCancelBtn.addEventListener("click", () => {
  void (async () => {
    if (!weixinSessionId) return
    try {
      await cancelWeixinLogin(weixinSessionId)
    } catch {
      // ignore
    }
    stopWeixinPoll()
    weixinSessionId = undefined
    lastWeixinSession = undefined
    weixinCancelBtn.hidden = true
    weixinQrHost.innerHTML = ""
    setWeixinStatusText(t("admin.weixin.phase.cancelled"))
  })()
})

void (async () => {
  try {
    const status = await fetchAdminStatus()
    gateStatus.dataset.configured = status.configured ? "1" : "0"
    gateStatus.textContent = status.configured
      ? t("admin.gate.keyConfigured")
      : t("admin.gate.keyNotConfigured")
    if (!status.configured) {
      ;(loginForm.querySelector("button") as HTMLButtonElement).disabled = true
    }
    if (getAdminToken()) {
      try {
        await bootAuthenticated()
      } catch {
        clearAdminToken()
        showGate(t("admin.gate.sessionExpired"))
      }
    } else {
      showGate()
    }
  } catch (error) {
    showGate(error instanceof Error ? error.message : String(error))
  }
})()
