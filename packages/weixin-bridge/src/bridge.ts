import crypto from "node:crypto"
import path from "node:path"
import {
  ChannelSessionRelay,
  chunkText,
  createChannelClient,
  deliverOutboundAttachments,
  ensureChannelsPluginInOpencodeConfig,
  handleAgentCommand,
  isMessageProcessed,
  latestAssistantText,
  loadSyncBuf,
  parseAgentCommand,
  promptSession,
  rememberContextToken,
  rememberLastMessage,
  resolveActiveAgentTarget,
  runOpencodeEventLoop,
  saveAttachment,
  saveSyncBuf,
  verifyOpencode,
  type ChannelPromptFile,
  type OpencodeClient,
} from "@gatehouse/core/channels"
import { MessageState, MessageType, type WeixinBridgeConfig, type WeixinMessage } from "./ilink/types.ts"
import { getConfig, getUpdates, sendMessage, sendTyping, type IlinkClientOptions } from "./ilink/api.ts"
import { imageItems, inboundText, isUserTextMessage, unsupportedMediaReply } from "./ilink/inbound.ts"
import { downloadImageItem, mimeFromImageBytes } from "./ilink/media.ts"
import { loadCredentials } from "./ilink/auth.ts"
import { sendImageFile } from "./ilink/send-image.ts"

function ilinkOptions(config: WeixinBridgeConfig, token: string, baseUrl: string): IlinkClientOptions {
  return {
    baseUrl,
    token,
    botAgent: config.botAgent,
  }
}

function buildTextReply(to: string, text: string, contextToken: string) {
  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: crypto.randomUUID(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken,
    },
  }
}

async function sendTextChunks(
  opts: IlinkClientOptions,
  to: string,
  text: string,
  contextToken: string,
) {
  for (const chunk of chunkText(text)) {
    await sendMessage({
      ...opts,
      body: buildTextReply(to, chunk, contextToken),
    })
  }
}

async function maybeSendTyping(opts: IlinkClientOptions, userId: string, contextToken: string) {
  const config = await getConfig({ ...opts, ilinkUserId: userId, contextToken }).catch(() => undefined)
  if (!config?.typing_ticket) return
  await sendTyping({
    ...opts,
    ilinkUserId: userId,
    typingTicket: config.typing_ticket,
    status: 1,
  }).catch(() => undefined)
}

async function cancelTyping(opts: IlinkClientOptions, userId: string, contextToken: string) {
  const config = await getConfig({ ...opts, ilinkUserId: userId, contextToken }).catch(() => undefined)
  if (!config?.typing_ticket) return
  await sendTyping({
    ...opts,
    ilinkUserId: userId,
    typingTicket: config.typing_ticket,
    status: 2,
  }).catch(() => undefined)
}

type PendingMessage = {
  client: OpencodeClient
  opts: IlinkClientOptions
  msg: WeixinMessage
}

function sortedMessages(msgs: WeixinMessage[] | undefined) {
  return [...(msgs ?? [])].sort((a, b) => (a.message_id ?? 0) - (b.message_id ?? 0))
}

export class WeixinLeadBridge {
  private readonly queues = new Map<string, PendingMessage[]>()
  private readonly draining = new Set<string>()
  private syncBuf = ""
  private credentials: ReturnType<typeof loadCredentials>
  private relay: ChannelSessionRelay | undefined

  constructor(private readonly config: WeixinBridgeConfig) {
    this.syncBuf = loadSyncBuf(config.stateDir)
    this.credentials = loadCredentials(config.stateDir)
  }

  async start() {
    if (!this.credentials?.botToken) {
      throw new Error("WeChat credentials not found — run: bunx @gatehouse/core channels login weixin")
    }
    const plugin = await ensureChannelsPluginInOpencodeConfig(this.config.projectDir)
    await verifyOpencode(this.config)
    const client = createChannelClient(this.config)
    const opts = ilinkOptions(this.config, this.credentials.botToken, this.credentials.baseUrl)
    this.relay = new ChannelSessionRelay(client, this.config, {
      sendText: async ({ userId, text, contextToken }) => {
        await sendTextChunks(opts, userId, text, contextToken)
      },
      deliverAttachments: async ({ userId, sessionId, contextToken }) => {
        await deliverOutboundAttachments({
          projectDir: this.config.projectDir,
          sessionId,
          handlers: {
            sendImage: async (_attachment, absolutePath) => {
              await sendImageFile({
                ...opts,
                toUserId: userId,
                contextToken,
                filepath: absolutePath,
                cdnBaseUrl: this.config.cdnBaseUrl,
              })
            },
            onUnsupported: async (attachment) => {
              await sendTextChunks(
                opts,
                userId,
                `暂不支持发送该文件类型（${attachment.mime}）：${attachment.filename}`,
                contextToken,
              )
            },
          },
        })
      },
    })
    void runOpencodeEventLoop({
      opencodeUrl: this.config.opencodeUrl,
      projectDir: this.config.projectDir,
      onEvent: (event) => this.relay?.handleOpencodeEvent(event),
    }).catch((error) => {
      console.error(`OpenCode event loop failed: ${error instanceof Error ? error.message : String(error)}`)
    })

    console.log(`Gatehouse WeChat Bridge started`)
    console.log(`  project: ${this.config.projectDir}`)
    console.log(`  OpenCode: ${this.config.opencodeUrl}`)
    console.log(`  iLink: ${this.credentials.baseUrl}`)
    console.log(`  state: ${this.config.stateDir}`)
    console.log(`  mode: private text + images (MVP)`)
    if (plugin.added) {
      console.log(`  wrote OpenCode plugin: ${plugin.spec}`)
    }

    while (true) {
      const updates = await getUpdates({ ...opts, getUpdatesBuf: this.syncBuf })
      if (updates.ret !== 0 && updates.ret !== undefined) {
        if (updates.errcode === -14) {
          throw new Error("WeChat session expired — re-run login")
        }
        console.error(`getUpdates ret=${updates.ret} errcode=${updates.errcode} errmsg=${updates.errmsg}`)
      }
      if (updates.get_updates_buf !== undefined) {
        this.syncBuf = updates.get_updates_buf
        saveSyncBuf(this.config.stateDir, this.syncBuf)
      }
      for (const msg of sortedMessages(updates.msgs)) {
        this.enqueue(client, opts, msg)
      }
    }
  }

  private enqueue(client: OpencodeClient, opts: IlinkClientOptions, msg: WeixinMessage) {
    if (!isUserTextMessage(msg)) return
    const userId = msg.from_user_id?.trim()
    if (!userId) return
    if (!msg.context_token) {
      console.error(`skip message without context_token from ${userId}`)
      return
    }
    if (msg.message_id !== undefined && isMessageProcessed(this.config.stateDir, userId, msg.message_id)) return

    const queue = this.queues.get(userId) ?? []
    queue.push({ client, opts, msg })
    this.queues.set(userId, queue)
    void this.drainUser(userId).catch((error) => {
      console.error(`drainUser failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async drainUser(userId: string) {
    if (this.draining.has(userId)) return
    this.draining.add(userId)
    try {
      while (true) {
        const queue = this.queues.get(userId)
        const next = queue?.shift()
        if (!next) break
        await this.processMessage(next.client, next.opts, next.msg)
      }
    } finally {
      this.draining.delete(userId)
    }
    if (this.queues.get(userId)?.length) {
      void this.drainUser(userId).catch((error) => {
        console.error(`drainUser failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  private async processMessage(client: OpencodeClient, opts: IlinkClientOptions, msg: WeixinMessage) {
    const userId = msg.from_user_id?.trim()
    if (!userId || !msg.context_token) return
    if (msg.message_id !== undefined && isMessageProcessed(this.config.stateDir, userId, msg.message_id)) return

    try {
      rememberContextToken(this.config.stateDir, userId, msg.context_token)
      const text = inboundText(msg)
      await maybeSendTyping(opts, userId, msg.context_token)

      const agentCommand = text ? parseAgentCommand(text) : undefined
      if (agentCommand) {
        const reply = await handleAgentCommand(client, this.config, userId, agentCommand)
        await cancelTyping(opts, userId, msg.context_token)
        await sendTextChunks(opts, userId, reply, msg.context_token)
        if (msg.message_id !== undefined) {
          rememberLastMessage(this.config.stateDir, userId, msg.message_id)
        }
        return
      }

      const files: ChannelPromptFile[] = []
      for (const item of imageItems(msg)) {
        const data = await downloadImageItem(item, this.config.cdnBaseUrl)
        const imageType = mimeFromImageBytes(data)
        const filepath = await saveAttachment(this.config.projectDir, `image.${imageType.ext}`, data)
        files.push({
          path: filepath,
          mime: imageType.mime,
          filename: path.basename(filepath),
        })
      }

      if (!text && !files.length) {
        await cancelTyping(opts, userId, msg.context_token)
        await sendTextChunks(opts, userId, unsupportedMediaReply(msg), msg.context_token)
        if (msg.message_id !== undefined) {
          rememberLastMessage(this.config.stateDir, userId, msg.message_id)
        }
        return
      }

      const target = await resolveActiveAgentTarget(client, this.config, userId)
      const promptText =
        text || (files.length ? "用户发送了一张图片，请查看并根据图片内容回复。" : unsupportedMediaReply(msg))
      await promptSession(client, this.config, {
        sessionId: target.sessionId,
        opencodeAgent: target.opencodeAgent,
        text: promptText,
        files: files.length ? files : undefined,
      })
      await cancelTyping(opts, userId, msg.context_token)
      const relay = this.relay
      if (!relay) throw new Error("session relay not initialized")
      const delivered = await relay.deliverNewAssistantMessages({
        userId,
        sessionId: target.sessionId,
        contextToken: msg.context_token,
      })
      if (delivered === 0) {
        const assistantText = await latestAssistantText(client, this.config, target.sessionId)
        if (!assistantText) {
          await sendTextChunks(opts, userId, "已收到，但没有返回文本回复。", msg.context_token)
        }
      }
      if (msg.message_id !== undefined) {
        rememberLastMessage(this.config.stateDir, userId, msg.message_id)
      }
    } catch (error) {
      await cancelTyping(opts, userId, msg.context_token).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      await sendTextChunks(opts, userId, `处理失败：${message}`, msg.context_token).catch(() => undefined)
    }
  }
}

export async function runBridge(config: WeixinBridgeConfig) {
  const bridge = new WeixinLeadBridge(config)
  await bridge.start()
}
