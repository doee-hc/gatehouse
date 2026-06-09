import type { ChannelBridgeConfig } from "./types.ts"
import { listNewDeliverableAssistantMessages } from "./opencode/assistant-messages.ts"
import { readSessionStatusIdleEvent } from "./opencode/events.ts"
import type { OpencodeClient } from "./opencode/client.ts"
import {
  getLastContextToken,
  getLastDeliveredAssistantMessageId,
  listUsersBoundToSession,
  setLastDeliveredAssistantMessageId,
} from "./store/state.ts"

export type ChannelOutboundHandlers = {
  sendText: (input: { userId: string; text: string; contextToken: string }) => Promise<void>
  deliverAttachments?: (input: { userId: string; sessionId: string; contextToken: string }) => Promise<void>
}

export class ChannelSessionRelay {
  private readonly sessionLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly client: OpencodeClient,
    private readonly config: ChannelBridgeConfig,
    private readonly handlers: ChannelOutboundHandlers,
  ) {}

  async handleOpencodeEvent(event: unknown) {
    const idle = readSessionStatusIdleEvent(event)
    if (!idle) return
    await this.flushSession(idle.sessionId)
  }

  private async withSessionLock<T>(sessionId: string, run: () => Promise<T>) {
    const key = sessionId.trim()
    const previous = this.sessionLocks.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = previous.then(() => gate)
    this.sessionLocks.set(key, chain)
    await previous
    try {
      return await run()
    } finally {
      release()
      if (this.sessionLocks.get(key) === chain) this.sessionLocks.delete(key)
    }
  }

  async flushSession(sessionId: string) {
    const key = sessionId.trim()
    if (!key) return
    await this.withSessionLock(key, async () => {
      const userIds = listUsersBoundToSession(this.config.stateDir, this.config.projectDir, key)
      for (const userId of userIds) {
        await this.deliverNewAssistantMessagesUnlocked({ userId, sessionId: key }).catch((error) => {
          console.error(
            `channel relay deliver failed (${userId}/${key}): ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      }
    })
  }

  async deliverNewAssistantMessages(input: { userId: string; sessionId: string; contextToken?: string }) {
    const sessionId = input.sessionId.trim()
    if (!sessionId) return 0
    return this.withSessionLock(sessionId, () => this.deliverNewAssistantMessagesUnlocked(input))
  }

  private async deliverNewAssistantMessagesUnlocked(input: {
    userId: string
    sessionId: string
    contextToken?: string
  }) {
    const userId = input.userId.trim()
    const sessionId = input.sessionId.trim()
    if (!userId || !sessionId) return 0

    const contextToken = input.contextToken?.trim() || getLastContextToken(this.config.stateDir, userId)
    if (!contextToken) {
      console.error(`skip outbound relay for ${userId}: missing context_token (user must message from WeChat first)`)
      return 0
    }

    const afterId = getLastDeliveredAssistantMessageId(this.config.stateDir, userId, sessionId)
    const messages = await listNewDeliverableAssistantMessages(this.client, this.config, sessionId, afterId)
    if (!messages.length) return 0

    for (const message of messages) {
      await this.handlers.sendText({ userId, text: message.text, contextToken })
      setLastDeliveredAssistantMessageId(this.config.stateDir, userId, sessionId, message.id)
    }

    if (this.handlers.deliverAttachments) {
      await this.handlers.deliverAttachments({ userId, sessionId, contextToken })
    }
    return messages.length
  }
}

