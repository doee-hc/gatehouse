import path from "node:path"
import type { FeishuApiResponse, FeishuBridgeConfig } from "./types.ts"

type TokenState = {
  token: string
  expiresAt: number
}

export type FeishuClient = {
  replyText(messageId: string, text: string): Promise<void>
  replyImage(messageId: string, filepath: string): Promise<void>
  downloadResource(
    messageId: string,
    fileKey: string,
    type: "image" | "file",
  ): Promise<{ data: Uint8Array; contentType: string | null }>
}

function apiBase(config: FeishuBridgeConfig) {
  return config.apiBaseUrl.endsWith("/") ? config.apiBaseUrl : `${config.apiBaseUrl}/`
}

export function createFeishuClient(config: FeishuBridgeConfig): FeishuClient {
  let tokenState: TokenState | null = null
  let refreshPromise: Promise<string> | null = null

  async function refreshToken() {
    const response = await fetch(new URL("auth/v3/tenant_access_token/internal", apiBase(config)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    })
    const data = (await response.json()) as {
      code: number
      msg: string
      tenant_access_token?: string
      expire?: number
    }
    if (data.code !== 0 || !data.tenant_access_token || !data.expire) {
      throw new Error(`Failed to obtain Feishu tenant_access_token: ${data.msg}`)
    }
    tokenState = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + data.expire * 1000,
    }
    return tokenState.token
  }

  async function getToken() {
    if (tokenState && tokenState.expiresAt - Date.now() > 300_000) {
      return tokenState.token
    }
    if (refreshPromise) return refreshPromise
    refreshPromise = refreshToken()
    try {
      return await refreshPromise
    } finally {
      refreshPromise = null
    }
  }

  async function apiRequest(method: string, urlPath: string, body?: Record<string, unknown>, retry = 0) {
    const token = await getToken()
    const response = await fetch(new URL(urlPath.replace(/^\//, ""), apiBase(config)), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await response.json()) as FeishuApiResponse
    if (data.code === 99991663 && retry < 1) {
      tokenState = null
      return apiRequest(method, urlPath, body, retry + 1)
    }
    if (data.code !== 0) {
      throw new Error(`Feishu API ${urlPath} failed: ${data.code} ${data.msg}`)
    }
    return data
  }

  return {
    async replyText(messageId, text) {
      await apiRequest("POST", `/im/v1/messages/${messageId}/reply`, {
        msg_type: "text",
        content: JSON.stringify({ text }),
      })
    },
    async replyImage(messageId, filepath) {
      const token = await getToken()
      const bytes = await Bun.file(filepath).arrayBuffer()
      const form = new FormData()
      form.append("image_type", "message")
      form.append("image", new Blob([bytes]), path.basename(filepath))
      const uploadResponse = await fetch(new URL("im/v1/images", apiBase(config)), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const uploadData = (await uploadResponse.json()) as FeishuApiResponse & {
        data?: { image_key?: string }
      }
      if (uploadData.code !== 0 || !uploadData.data?.image_key) {
        throw new Error(`Feishu image upload failed: ${uploadData.code} ${uploadData.msg}`)
      }
      await apiRequest("POST", `/im/v1/messages/${messageId}/reply`, {
        msg_type: "image",
        content: JSON.stringify({ image_key: uploadData.data.image_key }),
      })
    },
    async downloadResource(messageId, fileKey, type) {
      const token = await getToken()
      const url = new URL(
        `im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}`,
        apiBase(config),
      )
      url.searchParams.set("type", type)
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`Feishu resource download failed: ${response.status} ${body}`)
      }
      const data = new Uint8Array(await response.arrayBuffer())
      return { data, contentType: response.headers.get("content-type") }
    },
  }
}
