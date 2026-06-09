import { fetchWeixinQrCode, pollWeixinQrStatus } from "./ilink-api.ts"
import { saveWeixinCredentials } from "./credentials.ts"
import { updateChannelConfig } from "../supervisor/config.ts"

export type WeixinLoginPhase = "pending" | "wait" | "scaned" | "expired" | "confirmed" | "failed" | "cancelled"

export type WeixinLoginSessionSnapshot = {
  id: string
  phase: WeixinLoginPhase
  qrContent?: string
  qrToken?: string
  message?: string
  createdAt: number
  updatedAt: number
}

type InternalSession = WeixinLoginSessionSnapshot & {
  ilinkBaseUrl: string
  botType: string
  projectDir: string
  qrcode: string
  refreshCount: number
  deadline: number
  polling: boolean
}

const DEFAULT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com"
const DEFAULT_BOT_TYPE = "3"
const SESSION_TTL_MS = 480_000
const MAX_QR_REFRESH = 3

function newSessionId() {
  return crypto.randomUUID()
}

export class WeixinLoginSessionManager {
  private readonly sessions = new Map<string, InternalSession>()

  constructor(
    private readonly projectDir: string,
    private readonly ilinkBaseUrl = process.env.WIXIN_ILINK_BASE_URL?.trim() || DEFAULT_ILINK_BASE_URL,
    private readonly botType = process.env.WIXIN_BOT_TYPE?.trim() || DEFAULT_BOT_TYPE,
  ) {}

  listSessions() {
    return [...this.sessions.values()].map((session) => this.snapshot(session))
  }

  getSession(id: string) {
    const session = this.sessions.get(id)
    return session ? this.snapshot(session) : undefined
  }

  async startSession() {
    const qr = await fetchWeixinQrCode(this.ilinkBaseUrl, this.botType)
    const now = Date.now()
    const id = newSessionId()
    const session: InternalSession = {
      id,
      phase: "wait",
      qrContent: qr.qrcode_img_content,
      qrToken: qr.qrcode,
      createdAt: now,
      updatedAt: now,
      ilinkBaseUrl: this.ilinkBaseUrl,
      botType: this.botType,
      projectDir: this.projectDir,
      qrcode: qr.qrcode,
      refreshCount: 0,
      deadline: now + SESSION_TTL_MS,
      polling: false,
    }
    this.sessions.set(id, session)
    this.gc()
    void this.pollSession(id)
    return this.snapshot(session)
  }

  cancelSession(id: string) {
    const session = this.sessions.get(id)
    if (!session) return false
    session.phase = "cancelled"
    session.updatedAt = Date.now()
    this.sessions.delete(id)
    return true
  }

  async tickSession(id: string) {
    const session = this.sessions.get(id)
    if (!session) return undefined
    if (!session.polling) void this.pollSession(id)
    return this.snapshot(session)
  }

  private snapshot(session: InternalSession): WeixinLoginSessionSnapshot {
    return {
      id: session.id,
      phase: session.phase,
      qrContent: session.qrContent,
      qrToken: session.qrToken,
      message: session.message,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  private gc() {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now > session.deadline + 60_000 || session.phase === "confirmed" || session.phase === "failed") {
        this.sessions.delete(id)
      }
    }
  }

  private async pollSession(id: string) {
    const session = this.sessions.get(id)
    if (!session || session.polling) return
    session.polling = true

    try {
      while (this.sessions.has(id)) {
        const current = this.sessions.get(id)!
        if (current.phase === "cancelled") return
        if (Date.now() > current.deadline) {
          current.phase = "failed"
          current.message = "登录超时"
          current.updatedAt = Date.now()
          return
        }

        const status = await pollWeixinQrStatus(current.ilinkBaseUrl, current.qrcode)
        current.updatedAt = Date.now()

        if (status.status === "wait") {
          current.phase = "wait"
          await Bun.sleep(1000)
          continue
        }
        if (status.status === "scaned") {
          current.phase = "scaned"
          current.message = "已扫码，请在微信中确认"
          await Bun.sleep(1000)
          continue
        }
        if (status.status === "expired") {
          current.refreshCount += 1
          if (current.refreshCount > MAX_QR_REFRESH) {
            current.phase = "failed"
            current.message = "二维码多次过期，请重新开始登录"
            return
          }
          const next = await fetchWeixinQrCode(current.ilinkBaseUrl, current.botType)
          current.qrcode = next.qrcode
          current.qrContent = next.qrcode_img_content
          current.qrToken = next.qrcode
          current.phase = "expired"
          current.message = "二维码已过期，已自动刷新"
          await Bun.sleep(500)
          current.phase = "wait"
          continue
        }
        if (status.status === "confirmed") {
          if (!status.bot_token) {
            current.phase = "failed"
            current.message = "登录成功但未返回 bot_token"
            return
          }
          saveWeixinCredentials(current.projectDir, {
            botToken: status.bot_token,
            accountId: status.ilink_bot_id,
            baseUrl: status.baseurl?.trim() || current.ilinkBaseUrl,
            loggedInAt: Date.now(),
          })
          updateChannelConfig(current.projectDir, "weixin", { enabled: true })
          current.phase = "confirmed"
          current.message = "微信登录成功"
          return
        }
      }
    } catch (error) {
      const current = this.sessions.get(id)
      if (!current) return
      current.phase = "failed"
      current.message = error instanceof Error ? error.message : String(error)
      current.updatedAt = Date.now()
    } finally {
      const current = this.sessions.get(id)
      if (current) current.polling = false
    }
  }
}

const managers = new Map<string, WeixinLoginSessionManager>()

export function getWeixinLoginSessionManager(projectDir: string) {
  const key = projectDir
  let manager = managers.get(key)
  if (!manager) {
    manager = new WeixinLoginSessionManager(projectDir)
    managers.set(key, manager)
  }
  return manager
}
