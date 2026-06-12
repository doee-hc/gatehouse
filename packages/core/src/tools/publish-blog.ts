import { tool, type PluginInput } from "@opencode-ai/plugin"
import { toolFail, toolMetadata } from "./envelope.ts"

export function publishBlogTool(_input: PluginInput) {
  return tool({
    description:
      "Retired — Portal publish is system-managed. Deliverables publish on gatehouse_mission_complete(done); domain SKILL posts publish on the same call.",
    args: {
      mission_id: tool.schema.string().optional().describe("Unused — tool retired"),
      report_path: tool.schema.string().min(1).describe("Unused — tool retired"),
    },
    async execute() {
      const toolName = "gatehouse_publish_blog"
      return {
        output: toolFail(
          toolName,
          "TOOL_RETIRED",
          "Portal publish is system-managed: deliverables and domain skills on gatehouse_mission_complete(done).",
        ),
        ...toolMetadata(toolName),
      }
    },
  })
}
