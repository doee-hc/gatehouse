import crypto from "node:crypto"
import {
  CHANNEL_VERSION,
  type GetConfigResp,
  type GetUpdatesResp,
  type SendMessageReq,
} from "./types.ts"

export type IlinkClientOptions = {
  baseUrl: string
  token: string
  botAgent?: string
  longPollTimeoutMs?: number
  apiTimeoutMs?: number
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), "utf-8").toString("base64")
}

function buildBaseInfo(botAgent?: string) {
  return {
    channel_version: CHANNEL_VERSION,
    ...(botAgent && { bot_agent: botAgent }),
  }
}

function buildHeaders(token: string, body: string) {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token.trim()}`,
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
  }
}

async function apiPost(params: {
  baseUrl: string
  endpoint: string
  body: string
  token: string
  timeoutMs: number
  label: string
}) {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(params.token, params.body),
      body: params.body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const rawText = await response.text()
    if (!response.ok) {
      throw new Error(`${params.label} ${response.status}: ${rawText.slice(0, 300)}`)
    }
    return rawText
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

export async function getUpdates(
  opts: IlinkClientOptions & { getUpdatesBuf: string },
): Promise<GetUpdatesResp> {
  const timeoutMs = opts.longPollTimeoutMs ?? 35_000
  try {
    const rawText = await apiPost({
      baseUrl: opts.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: opts.getUpdatesBuf,
        base_info: buildBaseInfo(opts.botAgent),
      }),
      token: opts.token,
      timeoutMs,
      label: "getUpdates",
    })
    return JSON.parse(rawText) as GetUpdatesResp
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: opts.getUpdatesBuf }
    }
    throw error
  }
}

export async function sendMessage(opts: IlinkClientOptions & { body: SendMessageReq }) {
  await apiPost({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...opts.body, base_info: buildBaseInfo(opts.botAgent) }),
    token: opts.token,
    timeoutMs: opts.apiTimeoutMs ?? 15_000,
    label: "sendMessage",
  })
}

export async function getConfig(
  opts: IlinkClientOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiPost({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: opts.ilinkUserId,
      context_token: opts.contextToken,
      base_info: buildBaseInfo(opts.botAgent),
    }),
    token: opts.token,
    timeoutMs: opts.apiTimeoutMs ?? 10_000,
    label: "getConfig",
  })
  return JSON.parse(rawText) as GetConfigResp
}

export async function sendTyping(
  opts: IlinkClientOptions & { ilinkUserId: string; typingTicket: string; status: 1 | 2 },
) {
  await apiPost({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({
      ilink_user_id: opts.ilinkUserId,
      typing_ticket: opts.typingTicket,
      status: opts.status,
      base_info: buildBaseInfo(opts.botAgent),
    }),
    token: opts.token,
    timeoutMs: opts.apiTimeoutMs ?? 10_000,
    label: "sendTyping",
  })
}

export async function getUploadUrl(
  opts: IlinkClientOptions & {
    filekey: string
    media_type: number
    to_user_id: string
    rawsize: number
    rawfilemd5: string
    filesize: number
    aeskey: string
    no_need_thumb?: boolean
  },
) {
  const rawText = await apiPost({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: opts.filekey,
      media_type: opts.media_type,
      to_user_id: opts.to_user_id,
      rawsize: opts.rawsize,
      rawfilemd5: opts.rawfilemd5,
      filesize: opts.filesize,
      no_need_thumb: opts.no_need_thumb ?? true,
      aeskey: opts.aeskey,
      base_info: buildBaseInfo(opts.botAgent),
    }),
    token: opts.token,
    timeoutMs: opts.apiTimeoutMs ?? 15_000,
    label: "getUploadUrl",
  })
  return JSON.parse(rawText) as { upload_param?: string; upload_full_url?: string; ret?: number; errmsg?: string }
}

export async function fetchQrCode(baseUrl: string, botType: string) {
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, ensureTrailingSlash(baseUrl))
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`get_bot_qrcode failed: ${response.status}`)
  }
  return (await response.json()) as { qrcode: string; qrcode_img_content: string }
}

export async function pollQrStatus(baseUrl: string, qrcode: string) {
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, ensureTrailingSlash(baseUrl))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) {
      throw new Error(`get_qrcode_status failed: ${response.status}`)
    }
    return (await response.json()) as {
      status: "wait" | "scaned" | "confirmed" | "expired"
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
    }
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" as const }
    }
    throw error
  }
}
