import crypto from "node:crypto"
import path from "node:path"
import { encryptAesEcb, aesEcbPaddedSize } from "./aes-ecb.ts"
import { buildCdnUploadUrl } from "./cdn-url.ts"

export async function uploadBufferToCdn(input: {
  ciphertext: Buffer
  uploadFullUrl?: string
  uploadParam?: string
  filekey: string
  cdnBaseUrl: string
}) {
  const cdnUrl = input.uploadFullUrl?.trim()
    ? input.uploadFullUrl.trim()
    : input.uploadParam
      ? buildCdnUploadUrl(input.cdnBaseUrl, input.uploadParam, input.filekey)
      : undefined
  if (!cdnUrl) throw new Error("缺少 CDN 上传 URL")
  const response = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(input.ciphertext),
  })
  if (!response.ok) {
    const errorMsg = response.headers.get("x-error-message") || `HTTP ${response.status}`
    throw new Error(`CDN 上传失败: ${errorMsg}`)
  }
  const downloadParam = response.headers.get("x-encrypted-param")
  if (!downloadParam) throw new Error("CDN 上传成功但缺少 x-encrypted-param")
  return { downloadParam }
}

export async function uploadLocalImage(input: {
  filepath: string
  cdnBaseUrl: string
  getUploadUrl: (body: {
    filekey: string
    media_type: number
    to_user_id: string
    rawsize: number
    rawfilemd5: string
    filesize: number
    aeskey: string
    no_need_thumb: boolean
  }) => Promise<{ upload_param?: string; upload_full_url?: string }>
  toUserId: string
}) {
  const plaintext = Buffer.from(await Bun.file(input.filepath).arrayBuffer())
  const rawsize = plaintext.length
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex")
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = crypto.randomBytes(16).toString("hex")
  const aeskey = crypto.randomBytes(16)
  const uploadUrl = await input.getUploadUrl({
    filekey,
    media_type: 1,
    to_user_id: input.toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    aeskey: aeskey.toString("hex"),
    no_need_thumb: true,
  })
  const ciphertext = encryptAesEcb(plaintext, aeskey)
  const uploaded = await uploadBufferToCdn({
    ciphertext,
    uploadFullUrl: uploadUrl.upload_full_url,
    uploadParam: uploadUrl.upload_param,
    filekey,
    cdnBaseUrl: input.cdnBaseUrl,
  })
  return {
    downloadEncryptedQueryParam: uploaded.downloadParam,
    aeskeyHex: aeskey.toString("hex"),
    fileSizeCiphertext: filesize,
    filename: path.basename(input.filepath),
  }
}
