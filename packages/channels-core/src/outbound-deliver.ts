import { consumeOutboundQueue, isImageAttachment, type OutboundAttachment } from "./outbound.ts"

export type OutboundDeliverHandlers = {
  sendImage(attachment: OutboundAttachment, absolutePath: string): Promise<void>
  sendFile?(attachment: OutboundAttachment, absolutePath: string): Promise<void>
  onUnsupported?(attachment: OutboundAttachment): Promise<void>
}

export async function deliverOutboundAttachments(input: {
  projectDir: string
  sessionId: string
  handlers: OutboundDeliverHandlers
}) {
  const items = await consumeOutboundQueue(input.projectDir, input.sessionId)
  for (const item of items) {
    if (isImageAttachment(item)) {
      await input.handlers.sendImage(item, item.path)
      continue
    }
    if (input.handlers.sendFile) {
      await input.handlers.sendFile(item, item.path)
      continue
    }
    if (input.handlers.onUnsupported) {
      await input.handlers.onUnsupported(item)
    }
  }
  return items.length
}
