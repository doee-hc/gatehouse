import { decryptAesEcb } from "./aes-ecb.ts"

const CDN_URL_FALLBACK = true

import { buildCdnDownloadUrl } from "./cdn-url.ts"
export function parseAesKey(aesKeyBase64: string) {
  const decoded = Buffer.from(aesKeyBase64, "base64")
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex")
  }
  throw new Error(
    `aes_key must be base64-encoded 16-byte raw or 32-char hex, got ${decoded.length} bytes after decode`,
  )
}

async function fetchCdnBytes(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`CDN download failed ${response.status}: ${body.slice(0, 200)}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function resolveDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string, fullUrl?: string) {
  if (fullUrl) return fullUrl
  if (CDN_URL_FALLBACK && encryptedQueryParam) {
    return buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl)
  }
  throw new Error("Missing CDN full_url or encrypt_query_param")
}

export async function downloadAndDecryptBuffer(input: {
  encryptedQueryParam: string
  aesKeyBase64: string
  cdnBaseUrl: string
  fullUrl?: string
}) {
  const key = parseAesKey(input.aesKeyBase64)
  const url = resolveDownloadUrl(input.encryptedQueryParam, input.cdnBaseUrl, input.fullUrl)
  const encrypted = await fetchCdnBytes(url)
  return decryptAesEcb(encrypted, key)
}

export async function downloadPlainCdnBuffer(input: {
  encryptedQueryParam: string
  cdnBaseUrl: string
  fullUrl?: string
}) {
  const url = resolveDownloadUrl(input.encryptedQueryParam, input.cdnBaseUrl, input.fullUrl)
  return fetchCdnBytes(url)
}
