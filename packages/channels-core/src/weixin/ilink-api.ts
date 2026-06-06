function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

export type WeixinQrCodeResponse = {
  qrcode: string
  qrcode_img_content: string
}

export type WeixinQrStatus =
  | { status: "wait" }
  | { status: "scaned" }
  | { status: "expired" }
  | {
      status: "confirmed"
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
    }

export async function fetchWeixinQrCode(baseUrl: string, botType: string): Promise<WeixinQrCodeResponse> {
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, ensureTrailingSlash(baseUrl))
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`get_bot_qrcode failed: ${response.status}`)
  }
  return (await response.json()) as WeixinQrCodeResponse
}

export async function pollWeixinQrStatus(baseUrl: string, qrcode: string): Promise<WeixinQrStatus> {
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
    return (await response.json()) as WeixinQrStatus
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" }
    }
    throw error
  }
}
