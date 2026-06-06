import type { RegistryAgent } from "../registry/types.ts"

export type WatchdogSendMessageEvent = {
  missionId?: string
  sender: RegistryAgent
  recipient: RegistryAgent
}

const handlers = new Map<string, (event: WatchdogSendMessageEvent) => void>()

export function registerWatchdogSendHandler(
  directory: string,
  handler: (event: WatchdogSendMessageEvent) => void,
) {
  handlers.set(directory, handler)
  return () => {
    handlers.delete(directory)
  }
}

export function notifyWatchdogSendMessage(directory: string, event: WatchdogSendMessageEvent) {
  handlers.get(directory)?.(event)
}
