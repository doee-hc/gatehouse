import crypto from "node:crypto"
import { getUploadUrl, sendMessage, type IlinkClientOptions } from "./api.ts"
import { uploadLocalImage } from "./cdn/upload.ts"
import { MessageItemType, MessageState, MessageType } from "./types.ts"

export async function sendImageFile(
  opts: IlinkClientOptions & { toUserId: string; contextToken: string; filepath: string; cdnBaseUrl: string },
) {
  const uploaded = await uploadLocalImage({
    filepath: opts.filepath,
    cdnBaseUrl: opts.cdnBaseUrl,
    toUserId: opts.toUserId,
    getUploadUrl: (body) => getUploadUrl({ ...opts, ...body }),
  })
  await sendMessage({
    ...opts,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: opts.toUserId,
        client_id: crypto.randomUUID(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: opts.contextToken,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: {
                encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
                encrypt_type: 1,
              },
              mid_size: uploaded.fileSizeCiphertext,
            },
          },
        ],
      },
    },
  })
}
