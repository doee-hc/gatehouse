import { createOpencodeClient } from "@opencode-ai/sdk"
import type { GatehouseClient } from "./client.ts"

export function defaultOpencodeBaseUrl() {
  return process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
}

/** OpenCode HTTP client for CLI / offline tooling (no plugin input). */
export function gatehouseClientFromOpencode(input: { baseUrl: string; directory: string }): GatehouseClient {
  const sdk = createOpencodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
  })
  return {
    session: {
      create: (args) => sdk.session.create(args as never),
      fork: (args) => sdk.session.fork?.(args as never),
      update: (args) => sdk.session.update?.(args as never),
      delete: (args) => sdk.session.delete?.(args as never),
      promptAsync: (args) => sdk.session.promptAsync(args as never),
      messages: (args) => sdk.session.messages(args as never),
      get: (args) => sdk.session.get(args as never),
      status: (args) => sdk.session.status?.(args as never),
      todo: (args) => sdk.session.todo?.(args as never),
    },
  }
}
