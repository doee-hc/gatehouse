import * as Lark from "@larksuiteoapi/node-sdk"
import { normalizeFeishuEvent } from "./inbound.ts"
import type { FeishuBridgeConfig, FeishuInboundMessage } from "./types.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function startFeishuWebSocket(
  config: FeishuBridgeConfig,
  onMessage: (message: FeishuInboundMessage) => Promise<void>,
) {
  const eventDispatcher = new Lark.EventDispatcher({})
  eventDispatcher.register({
    "im.message.receive_v1": async (data: unknown) => {
      if (!isRecord(data)) return
      const message = normalizeFeishuEvent(data)
      if (!message) return
      await onMessage(message)
    },
  })

  const domain = config.apiBaseUrl.includes("larksuite.com")
    ? Lark.Domain.Lark
    : Lark.Domain.Feishu

  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain,
    loggerLevel: Lark.LoggerLevel.info,
  })

  return {
    start() {
      wsClient.start({ eventDispatcher })
    },
  }
}
