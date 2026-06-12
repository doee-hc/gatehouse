import type { QqOnebotInboundMessage } from "./types.ts"

type ApiResponse = {
  status?: string
  retcode?: number
  data?: unknown
  echo?: string
  message?: string
  wording?: string
}

type PendingCall = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type OnebotClientOptions = {
  wsUrl: string
  accessToken?: string
  onGroupMessage: (message: QqOnebotInboundMessage) => void
  normalizeGroupMessage: (event: Record<string, unknown>, selfId: string) => QqOnebotInboundMessage | undefined
  onSelfId?: (selfId: string) => void
  onConnect?: () => void
  onDisconnect?: (reason: string) => void
}

const RECONNECT_MS = 5_000
const API_TIMEOUT_MS = 30_000

function buildWsUrl(wsUrl: string, accessToken?: string) {
  const url = new URL(wsUrl)
  if (accessToken?.trim()) {
    url.searchParams.set("access_token", accessToken.trim())
  }
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export class OnebotClient {
  private ws?: WebSocket
  private selfId = ""
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly pending = new Map<string, PendingCall>()

  constructor(private readonly options: OnebotClientOptions) {}

  get botId() {
    return this.selfId
  }

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.rejectAllPending("OneBot client stopped")
    this.ws?.close()
    this.ws = undefined
  }

  private connect() {
    if (this.stopped) return
    const url = buildWsUrl(this.options.wsUrl, this.options.accessToken)
    const ws = new WebSocket(url)
    this.ws = ws

    ws.addEventListener("open", () => {
      this.options.onConnect?.()
    })

    ws.addEventListener("message", (event) => {
      this.handlePayload(event.data)
    })

    ws.addEventListener("close", () => {
      this.ws = undefined
      this.rejectAllPending("WebSocket closed")
      this.options.onDisconnect?.("closed")
      this.scheduleReconnect()
    })

    ws.addEventListener("error", () => {
      this.options.onDisconnect?.("error")
    })
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, RECONNECT_MS)
  }

  private rejectAllPending(reason: string) {
    for (const [echo, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      this.pending.delete(echo)
    }
  }

  private handlePayload(raw: unknown) {
    let payload: unknown = raw
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
    }
    if (!isRecord(payload)) return

    const echo = readString(payload.echo)
    if (echo && this.pending.has(echo)) {
      const pending = this.pending.get(echo)!
      clearTimeout(pending.timer)
      this.pending.delete(echo)
      const retcode = typeof payload.retcode === "number" ? payload.retcode : -1
      if (payload.status === "ok" && retcode === 0) {
        pending.resolve(payload.data)
        return
      }
      const detail = readString(payload.wording) || readString(payload.message) || `retcode=${retcode}`
      pending.reject(new Error(`OneBot API failed: ${detail}`))
      return
    }

    const selfId = readString(payload.self_id)
    if (selfId) {
      this.selfId = selfId
      this.options.onSelfId?.(selfId)
    }

    const normalized = this.options.normalizeGroupMessage(payload, this.selfId)
    if (normalized) this.options.onGroupMessage(normalized)
  }

  async callApi(action: string, params: Record<string, unknown>) {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("OneBot WebSocket is not connected")
    }

    const echo = crypto.randomUUID()
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`OneBot API timeout: ${action}`))
      }, API_TIMEOUT_MS)
      this.pending.set(echo, { resolve, reject, timer })
      ws.send(JSON.stringify({ action, params, echo }))
    })
  }

  async sendGroupText(groupId: string, text: string) {
    await this.callApi("send_group_msg", {
      group_id: groupId,
      message: text,
    })
  }

  async sendGroupImage(groupId: string, absolutePath: string) {
    const normalized = absolutePath.replace(/\\/g, "/")
    const file = normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`
    await this.callApi("send_group_msg", {
      group_id: groupId,
      message: [{ type: "image", data: { file } }],
    })
  }
}
