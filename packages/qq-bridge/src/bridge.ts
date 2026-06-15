import {
  chunkText,
  createChannelClient,
  deliverOutboundAttachments,
  ensureChannelsPluginInOpencodeConfig,
  handleAgentCommand,
  isMessageKeyProcessed,
  downloadUrlAttachment,
  parseAgentCommand,
  parseAutopilotCommand,
  handleAutopilotCommand,
  promptSession,
  rememberMessageKey,
  resolveActiveAgentTarget,
  verifyOpencode,
  type ChannelPromptFile,
  type OpencodeClient,
} from "@gatehouse/core/channels"
import path from "node:path"
import { Bot, ReceiverMode, segment, type PrivateMessageEvent } from "qq-official-bot"
import { normalizePrivateMessage, unsupportedMediaReply } from "./qq/inbound.ts"
import type { QqBridgeConfig, QqInboundMessage } from "./qq/types.ts"

type PendingMessage = {
  client: OpencodeClient
  bot: Bot
  message: QqInboundMessage
}

export class QqLeadBridge {
  private readonly queues = new Map<string, PendingMessage[]>()
  private readonly draining = new Set<string>()
  private bot!: Bot

  constructor(private readonly config: QqBridgeConfig) {}

  async start() {
    const plugin = await ensureChannelsPluginInOpencodeConfig(this.config.projectDir)
    await verifyOpencode(this.config)
    const client = createChannelClient(this.config)

    this.bot = new Bot({
      appid: this.config.appId,
      secret: this.config.secret,
      sandbox: this.config.sandbox,
      removeAt: true,
      logLevel: "info",
      intents: ["GROUP_AND_C2C_EVENT"],
      mode: ReceiverMode.WEBSOCKET,
    })

    this.bot.on("message.private", (event: PrivateMessageEvent) => {
      const normalized = normalizePrivateMessage(event)
      if (!normalized) return
      this.enqueue(client, this.bot, normalized)
    })

    console.log("Gatehouse QQ Bridge started")
    console.log(`  project: ${this.config.projectDir}`)
    console.log(`  OpenCode: ${this.config.opencodeUrl}`)
    console.log(`  state: ${this.config.stateDir}`)
    console.log(`  sandbox: ${this.config.sandbox ? "yes" : "no"}`)
    console.log("  mode: official Bot private text + images (MVP)")
    if (plugin.added) {
      console.log(`  wrote OpenCode plugin: ${plugin.spec}`)
    }

    await this.bot.start()
    await new Promise<void>(() => {})
  }

  private enqueue(client: OpencodeClient, bot: Bot, message: QqInboundMessage) {
    if (isMessageKeyProcessed(this.config.stateDir, message.userId, message.eventId)) return

    const queue = this.queues.get(message.userId) ?? []
    queue.push({ client, bot, message })
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
        await this.processMessage(next.client, next.bot, next.message)
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

  private async processMessage(client: OpencodeClient, bot: Bot, message: QqInboundMessage) {
    if (isMessageKeyProcessed(this.config.stateDir, message.userId, message.eventId)) return

    try {
      const text = message.text
      const agentCommand = text ? parseAgentCommand(text) : undefined
      if (agentCommand) {
        const { text: reply } = await handleAgentCommand(client, this.config, message.userId, agentCommand)
        for (const chunk of chunkText(reply, 3000)) {
          await bot.messageService.sendPrivateMessage(message.userId, [segment.text(chunk)])
        }
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      const autopilotCommand = text ? parseAutopilotCommand(text) : undefined
      if (autopilotCommand) {
        const { text: reply } = await handleAutopilotCommand({
          projectDirectory: this.config.projectDir,
          command: autopilotCommand,
          enabledBy: "channel",
          deliverLeadNotice: { client: client as never },
        })
        for (const chunk of chunkText(reply, 3000)) {
          await bot.messageService.sendPrivateMessage(message.userId, [segment.text(chunk)])
        }
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      if (message.messageType === "media") {
        await bot.messageService.sendPrivateMessage(message.userId, [segment.text(unsupportedMediaReply())])
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      const files: ChannelPromptFile[] = []
      for (const image of message.images) {
        const downloaded = await downloadUrlAttachment(this.config.projectDir, image.url, image.fileName)
        files.push({
          path: downloaded.filepath,
          mime: downloaded.mime,
          filename: path.basename(downloaded.filepath),
        })
      }

      if (!text && !files.length) {
        await bot.messageService.sendPrivateMessage(message.userId, [segment.text(unsupportedMediaReply())])
        rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
        return
      }

      const target = await resolveActiveAgentTarget(client, this.config, message.userId)
      const promptText =
        text || (files.length ? "The user sent an image. Please review it and reply based on the image content." : unsupportedMediaReply())
      const reply = await promptSession(client, this.config, {
        sessionId: target.sessionId,
        opencodeAgent: target.opencodeAgent,
        text: promptText,
        files: files.length ? files : undefined,
      })

      for (const chunk of chunkText(reply, 3000)) {
        await bot.messageService.sendPrivateMessage(message.userId, [segment.text(chunk)])
      }
      await deliverOutboundAttachments({
        projectDir: this.config.projectDir,
        sessionId: target.sessionId,
        handlers: {
          sendImage: async (_attachment, absolutePath) => {
            await bot.messageService.sendPrivateMessage(message.userId, [segment.image(absolutePath)])
          },
          onUnsupported: async (attachment) => {
            await bot.messageService.sendPrivateMessage(message.userId, [
              segment.text(`Unsupported file type (${attachment.mime}): ${attachment.filename}`),
            ])
          },
        },
      })
      rememberMessageKey(this.config.stateDir, message.userId, message.eventId)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await bot.messageService
        .sendPrivateMessage(message.userId, [segment.text(`Processing failed: ${messageText}`)])
        .catch(() => undefined)
    }
  }
}

export async function runBridge(config: QqBridgeConfig) {
  const bridge = new QqLeadBridge(config)
  await bridge.start()
}
