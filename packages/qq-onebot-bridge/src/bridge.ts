import {
  chunkText,
  createChannelClient,
  deliverOutboundAttachments,
  ensureChannelsPluginInOpencodeConfig,
  handleAgentCommand,
  isMessageKeyProcessed,
  downloadUrlAttachment,
  parseAgentCommand,
  promptSession,
  rememberMessageKey,
  resolveActiveAgentTarget,
  verifyOpencode,
  type ChannelPromptFile,
  type OpencodeClient,
} from "@gatehouse/core/channels"
import path from "node:path"
import { OnebotClient } from "./onebot/client.ts"
import { normalizeGroupMessage, unsupportedMediaReply } from "./onebot/inbound.ts"
import type { QqOnebotBridgeConfig, QqOnebotInboundMessage } from "./onebot/types.ts"

type PendingMessage = {
  client: OpencodeClient
  onebot: OnebotClient
  message: QqOnebotInboundMessage
}

export class QqOnebotLeadBridge {
  private readonly queues = new Map<string, PendingMessage[]>()
  private readonly draining = new Set<string>()
  private onebot!: OnebotClient

  constructor(private readonly config: QqOnebotBridgeConfig) {}

  async start() {
    const plugin = await ensureChannelsPluginInOpencodeConfig(this.config.projectDir)
    await verifyOpencode(this.config)
    const client = createChannelClient(this.config)

    this.onebot = new OnebotClient({
      wsUrl: this.config.wsUrl,
      accessToken: this.config.accessToken,
      normalizeGroupMessage: (event, selfId) => normalizeGroupMessage(event, this.config, selfId),
      onGroupMessage: (message) => this.enqueue(client, this.onebot, message),
      onConnect: () => console.log(`  OneBot connected: ${this.config.wsUrl}`),
      onDisconnect: (reason) => console.log(`  OneBot disconnected (${reason}), reconnecting…`),
    })
    this.onebot.start()

    console.log("Gatehouse QQ OneBot Bridge started")
    console.log(`  project: ${this.config.projectDir}`)
    console.log(`  OpenCode: ${this.config.opencodeUrl}`)
    console.log(`  state: ${this.config.stateDir}`)
    console.log(`  NapCat WS: ${this.config.wsUrl}`)
    console.log(`  mode: group text + images via OneBot V11 (NapCat)`)
    console.log(`  require @: ${this.config.requireAt ? "yes" : "no"}`)
    if (this.config.groupAllowList.length) {
      console.log(`  groups: ${this.config.groupAllowList.join(", ")}`)
    } else {
      console.log("  groups: all")
    }
    if (plugin.added) {
      console.log(`  wrote OpenCode plugin: ${plugin.spec}`)
    }

    await new Promise<void>(() => {})
  }

  private enqueue(client: OpencodeClient, onebot: OnebotClient, message: QqOnebotInboundMessage) {
    if (isMessageKeyProcessed(this.config.stateDir, message.sessionKey, message.eventId)) return

    const queue = this.queues.get(message.sessionKey) ?? []
    queue.push({ client, onebot, message })
    this.queues.set(message.sessionKey, queue)
    void this.drainSession(message.sessionKey).catch((error) => {
      console.error(`drainSession failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async drainSession(sessionKey: string) {
    if (this.draining.has(sessionKey)) return
    this.draining.add(sessionKey)
    try {
      while (true) {
        const queue = this.queues.get(sessionKey)
        const next = queue?.shift()
        if (!next) break
        await this.processMessage(next.client, next.onebot, next.message)
      }
    } finally {
      this.draining.delete(sessionKey)
    }
    if (this.queues.get(sessionKey)?.length) {
      void this.drainSession(sessionKey).catch((error) => {
        console.error(`drainSession failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  private async processMessage(
    client: OpencodeClient,
    onebot: OnebotClient,
    message: QqOnebotInboundMessage,
  ) {
    if (isMessageKeyProcessed(this.config.stateDir, message.sessionKey, message.eventId)) return

    try {
      const text = message.text
      const agentCommand = text ? parseAgentCommand(text) : undefined
      if (agentCommand) {
        const { text: reply } = await handleAgentCommand(client, this.config, message.sessionKey, agentCommand)
        for (const chunk of chunkText(reply, 4000)) {
          await onebot.sendGroupText(message.groupId, chunk)
        }
        rememberMessageKey(this.config.stateDir, message.sessionKey, message.eventId)
        return
      }

      if (message.messageType === "media") {
        await onebot.sendGroupText(message.groupId, unsupportedMediaReply())
        rememberMessageKey(this.config.stateDir, message.sessionKey, message.eventId)
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
        await onebot.sendGroupText(message.groupId, unsupportedMediaReply())
        rememberMessageKey(this.config.stateDir, message.sessionKey, message.eventId)
        return
      }

      const target = await resolveActiveAgentTarget(client, this.config, message.sessionKey)
      const promptText =
        text || (files.length ? "用户发送了一张图片，请查看并根据图片内容回复。" : unsupportedMediaReply())
      const reply = await promptSession(client, this.config, {
        sessionId: target.sessionId,
        opencodeAgent: target.opencodeAgent,
        text: promptText,
        files: files.length ? files : undefined,
      })

      for (const chunk of chunkText(reply, 4000)) {
        await onebot.sendGroupText(message.groupId, chunk)
      }
      await deliverOutboundAttachments({
        projectDir: this.config.projectDir,
        sessionId: target.sessionId,
        handlers: {
          sendImage: async (_attachment, absolutePath) => {
            await onebot.sendGroupImage(message.groupId, absolutePath)
          },
          onUnsupported: async (attachment) => {
            await onebot.sendGroupText(
              message.groupId,
              `暂不支持发送该文件类型（${attachment.mime}）：${attachment.filename}`,
            )
          },
        },
      })
      rememberMessageKey(this.config.stateDir, message.sessionKey, message.eventId)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await onebot.sendGroupText(message.groupId, `处理失败：${messageText}`).catch(() => undefined)
    }
  }
}

export async function runBridge(config: QqOnebotBridgeConfig) {
  const bridge = new QqOnebotLeadBridge(config)
  await bridge.start()
}
