import {
  chunkText,
  createChannelClient,
  deliverOutboundAttachments,
  ensureChannelsPluginInOpencodeConfig,
  handleAgentCommand,
  isMessageKeyProcessed,
  mimeFromContentType,
  parseAgentCommand,
  promptSession,
  rememberMessageKey,
  resolveActiveAgentTarget,
  saveAttachment,
  verifyOpencode,
  type ChannelPromptFile,
  type OpencodeClient,
} from "@gatehouse/channels-core"
import path from "node:path"
import { createFeishuClient, type FeishuClient } from "./feishu/api.ts"
import { inboundText, parseImageKey, shouldHandleMessage, unsupportedMediaReply } from "./feishu/inbound.ts"
import { startFeishuWebSocket } from "./feishu/ws.ts"
import type { FeishuBridgeConfig, FeishuInboundMessage } from "./feishu/types.ts"

type PendingMessage = {
  client: OpencodeClient
  feishu: FeishuClient
  message: FeishuInboundMessage
}

export class FeishuLeadBridge {
  private readonly queues = new Map<string, PendingMessage[]>()
  private readonly draining = new Set<string>()

  constructor(private readonly config: FeishuBridgeConfig) {}

  async start() {
    const plugin = await ensureChannelsPluginInOpencodeConfig(this.config.projectDir)
    await verifyOpencode(this.config)
    const client = createChannelClient(this.config)
    const feishu = createFeishuClient(this.config)

    console.log("Gatehouse Feishu Bridge started")
    console.log(`  project: ${this.config.projectDir}`)
    console.log(`  OpenCode: ${this.config.opencodeUrl}`)
    console.log(`  state: ${this.config.stateDir}`)
    console.log("  mode: private/group text + images (MVP)")
    if (plugin.added) {
      console.log(`  wrote OpenCode plugin: ${plugin.spec}`)
    }

    const gateway = startFeishuWebSocket(this.config, async (message) => {
      this.enqueue(client, feishu, message)
    })
    gateway.start()

    await new Promise<void>(() => {})
  }

  private enqueue(client: OpencodeClient, feishu: FeishuClient, message: FeishuInboundMessage) {
    if (!shouldHandleMessage(message)) return
    if (isMessageKeyProcessed(this.config.stateDir, message.userId, message.eventId)) return

    const queue = this.queues.get(message.userId) ?? []
    queue.push({ client, feishu, message })
    this.queues.set(message.userId, queue)
    void this.drainUser(message.userId).catch((error) => {
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
        await this.processMessage(next.client, next.feishu, next.message)
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

  private async processMessage(client: OpencodeClient, feishu: FeishuClient, message: FeishuInboundMessage) {
    if (isMessageKeyProcessed(this.config.stateDir, message.userId, message.eventId)) return

    try {
      const text = inboundText(message)
      const agentCommand = text ? parseAgentCommand(text) : undefined
      if (agentCommand) {
        const reply = await handleAgentCommand(client, this.config, message.userId, agentCommand)
        for (const chunk of chunkText(reply, 3500)) {
          await feishu.replyText(message.messageId, chunk)
        }
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      const files: ChannelPromptFile[] = []
      if (message.messageType === "image") {
        const imageKey = parseImageKey(message.content)
        if (!imageKey) {
          await feishu.replyText(message.messageId, "无法解析图片消息，请重试或改用文字描述。")
          rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
          return
        }
        const downloaded = await feishu.downloadResource(message.messageId, imageKey, "image")
        const filepath = await saveAttachment(this.config.projectDir, "image.png", downloaded.data)
        files.push({
          path: filepath,
          mime: mimeFromContentType(downloaded.contentType, "image/png"),
          filename: path.basename(filepath),
        })
      }

      if (!text && !files.length) {
        await feishu.replyText(message.messageId, unsupportedMediaReply(message.messageType))
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      const target = await resolveActiveAgentTarget(client, this.config, message.userId)
      const promptText =
        text || (files.length ? "用户发送了一张图片，请查看并根据图片内容回复。" : unsupportedMediaReply(message.messageType))
      const reply = await promptSession(client, this.config, {
        sessionId: target.sessionId,
        opencodeAgent: target.opencodeAgent,
        text: promptText,
        files: files.length ? files : undefined,
      })

      for (const chunk of chunkText(reply, 3500)) {
        await feishu.replyText(message.messageId, chunk)
      }
      await deliverOutboundAttachments({
        projectDir: this.config.projectDir,
        sessionId: target.sessionId,
        handlers: {
          sendImage: async (_attachment, absolutePath) => {
            await feishu.replyImage(message.messageId, absolutePath)
          },
          onUnsupported: async (attachment) => {
            await feishu.replyText(
              message.messageId,
              `暂不支持发送该文件类型（${attachment.mime}）：${attachment.filename}`,
            )
          },
        },
      })
      rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await feishu.replyText(message.messageId, `处理失败：${messageText}`).catch(() => undefined)
    }
  }
}

export async function runBridge(config: FeishuBridgeConfig) {
  const bridge = new FeishuLeadBridge(config)
  await bridge.start()
}
