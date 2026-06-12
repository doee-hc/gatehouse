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

export type WatchdogDeliveryEvent = {
  missionId: string
  kind: "submitted" | "revision_requested"
}

const deliveryHandlers = new Map<string, (event: WatchdogDeliveryEvent) => void>()

export function registerWatchdogDeliveryHandler(
  directory: string,
  handler: (event: WatchdogDeliveryEvent) => void,
) {
  deliveryHandlers.set(directory, handler)
  return () => {
    deliveryHandlers.delete(directory)
  }
}

export function notifyWatchdogDeliveryEvent(directory: string, event: WatchdogDeliveryEvent) {
  deliveryHandlers.get(directory)?.(event)
}
