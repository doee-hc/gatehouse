import { tool, type PluginInput } from "@opencode-ai/plugin"
import path from "node:path"
import { mimeFromFilename } from "../attachments.ts"
import { enqueueOutboundFile, resolveOutboundPath } from "../outbound.ts"
import { toolErrorMetadata, toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function channelsSendFileTool(input: PluginInput) {
  return tool({
    description:
      "Queue a local project file for the active IM channel bridge to send back to the user after this turn completes. Use for images the user should receive in WeChat/Feishu/QQ. Path must be inside the Gatehouse project directory.",
    args: {
      path: tool.schema.string().min(1).describe("Absolute or project-relative file path"),
      mime: tool.schema.string().optional().describe("Optional MIME type override"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_channels_send_file"
      try {
        const filePath = args.path.trim()
        if (!filePath) {
          return {
            output: toolFail(toolName, "MISSING_PATH", "path is required"),
            ...toolErrorMetadata(toolName),
          }
        }
        const absolutePath = resolveOutboundPath(input.directory, filePath)
        if (!(await Bun.file(absolutePath).exists())) {
          return {
            output: toolFail(toolName, "NOT_FOUND", `File not found: ${absolutePath}`),
            ...toolErrorMetadata(toolName),
          }
        }
        const item = await enqueueOutboundFile(input.directory, context.sessionID, {
          path: absolutePath,
          mime: args.mime?.trim() || mimeFromFilename(path.basename(absolutePath)),
        })
        return {
          output: toolOk(toolName, {
            queued: true,
            session_id: context.sessionID,
            path: item.path,
            mime: item.mime,
            filename: item.filename,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          output: toolFail(toolName, "QUEUE_FAILED", message),
          ...toolErrorMetadata(toolName),
        }
      }
    },
  })
}
