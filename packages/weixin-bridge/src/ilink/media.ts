import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "./cdn/download.ts"
import { MessageItemType, type MessageItem } from "./types.ts"

export function mimeFromImageBytes(data: Uint8Array) {
  if (data.length >= 2 && data[0] === 0x89 && data[1] === 0x50) return { mime: "image/png", ext: "png" }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" }
  if (data.length >= 3 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { mime: "image/gif", ext: "gif" }
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" }
  }
  return { mime: "image/jpeg", ext: "jpg" }
}

export async function downloadImageItem(item: MessageItem, cdnBaseUrl: string) {
  if (item.type !== MessageItemType.IMAGE || !item.image_item) {
    throw new Error("不是图片消息")
  }
  const img = item.image_item
  if (!img.media?.encrypt_query_param && !img.media?.full_url) {
    throw new Error("图片缺少 CDN 引用")
  }
  const aesKeyBase64 = img.aeskey
    ? Buffer.from(img.aeskey, "hex").toString("base64")
    : img.media.aes_key
  const buffer = aesKeyBase64
    ? await downloadAndDecryptBuffer({
        encryptedQueryParam: img.media.encrypt_query_param ?? "",
        aesKeyBase64,
        cdnBaseUrl,
        fullUrl: img.media.full_url,
      })
    : await downloadPlainCdnBuffer({
        encryptedQueryParam: img.media.encrypt_query_param ?? "",
        cdnBaseUrl,
        fullUrl: img.media.full_url,
      })
  return new Uint8Array(buffer)
}
