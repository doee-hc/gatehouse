import { createOpencodeClient } from "@opencode-ai/sdk"
import type { ChannelBridgeConfig } from "../types.ts"

export function createOpencodeClientForBridge(config: ChannelBridgeConfig) {
  return createOpencodeClient({
    baseUrl: config.opencodeUrl,
    directory: config.projectDir,
  })
}

export type OpencodeClient = ReturnType<typeof createOpencodeClientForBridge>
