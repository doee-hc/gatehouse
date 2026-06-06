import "./admin.css"
import QRCode from "qrcode"
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
  if (!snapshot.supervisor.running) return "Supervisor 未运行"
  const started = snapshot.supervisor.startedAt
    ? new Date(snapshot.supervisor.startedAt).toLocaleString()
    : "—"
  return `Supervisor 运行中 · pid ${snapshot.supervisor.pid ?? "—"} · 启动于 ${started}`
}

function runtimeLabel(entry: ChannelAdminSnapshot["channels"][number]) {
  const parts = [
    entry.enabled ? "已启用" : "已禁用",
    entry.configured ? "已配置" : "未配置",
  ]
  const status = entry.runtime?.status
  if (status) parts.push(`runtime=${status}`)
  if (entry.runtime?.lastError) parts.push(entry.runtime.lastError)
  return parts.join(" · ")
}

function renderChannels(snapshot: ChannelAdminSnapshot, supervisorMessage?: string) {
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
  weixinQrHost.innerHTML = ""
  const payload = session.qrContent?.trim() || session.qrToken?.trim()
  if (!payload) {
    weixinQrHost.textContent = "未收到二维码内容"
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
    link.textContent = "在浏览器打开扫码页"
    link.style.display = "block"
    link.style.marginTop = "0.5rem"
    weixinQrHost.append(link)
  }
}

function weixinPhaseText(session: WeixinLoginSession) {
  if (session.message) return session.message
  switch (session.phase) {
    case "wait":
      return "等待扫码…"
    case "scaned":
      return "已扫码，请在微信中确认"
    case "expired":
      return "二维码已刷新，请重新扫码"
    case "confirmed":
      return "登录成功"
    case "failed":
      return "登录失败"
    case "cancelled":
      return "已取消"
    default:
      return session.phase
  }
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
    weixinStatus.textContent = weixinPhaseText(session)
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
    weixinStatus.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function bootAuthenticated() {
  showMain()
  await refreshChannels()
}

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
    supervisorStatus.textContent = "正在启动 Supervisor…"
    try {
      const result = await startSupervisor()
      renderChannels(result.snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      supervisorStatus.classList.add("admin-error")
      supervisorStatus.textContent = message
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
    } finally {
      supervisorStopBtn.disabled = false
    }
  })()
})

weixinStartBtn.addEventListener("click", () => {
  void (async () => {
    stopWeixinPoll()
    weixinQrHost.innerHTML = ""
    weixinStatus.textContent = "正在获取二维码…"
    weixinStartBtn.disabled = true
    try {
      const { session } = await startWeixinLogin()
      weixinSessionId = session.id
      weixinCancelBtn.hidden = false
      weixinStatus.textContent = weixinPhaseText(session)
      await renderWeixinQr(session)
      weixinPollTimer = setInterval(() => {
        void pollWeixinSession()
      }, 1500)
      void pollWeixinSession()
    } catch (error) {
      weixinStatus.textContent = error instanceof Error ? error.message : String(error)
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
    weixinCancelBtn.hidden = true
    weixinQrHost.innerHTML = ""
    weixinStatus.textContent = "已取消"
  })()
})

void (async () => {
  try {
    const status = await fetchAdminStatus()
    gateStatus.textContent = status.configured
      ? "已检测到 admin key 配置"
      : "未配置 admin key：请在 .gatehouse/config.yaml 的 portal.admin_key 查看或设置，或使用环境变量 GATEHOUSE_PORTAL_ADMIN_KEY"
    if (!status.configured) {
      ;(loginForm.querySelector("button") as HTMLButtonElement).disabled = true
    }
    if (getAdminToken()) {
      try {
        await bootAuthenticated()
      } catch {
        clearAdminToken()
        showGate("会话已过期，请重新输入 key")
      }
    } else {
      showGate()
    }
  } catch (error) {
    showGate(error instanceof Error ? error.message : String(error))
  }
})()
