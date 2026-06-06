import { tool, type PluginInput } from "@opencode-ai/plugin"
import { resolveBlogPostId, unpublishBlogPost } from "../portal/blog-publish.ts"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function normalizeReportPath(reportPath: string) {
  return reportPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function unpublishBlogTool(input: PluginInput) {
  return tool({
    description:
      "Unpublish a Gatehouse blog post from Portal UI. Only the agent that published it (matching published_by in blog-published.yaml) may unpublish. Pass the same report_path used when publishing.",
    args: {
      report_path: tool.schema
        .string()
        .min(1)
        .describe(
          "Project-relative markdown path (lead report, architect summary, root delivery, node retro, or domain SKILL.md)",
        ),
    },
    async execute(args, context) {
      const toolName = "gatehouse_unpublish_blog"
      try {
        const reportRel = normalizeReportPath(args.report_path)
        const postId = resolveBlogPostId(reportRel)
        if (!postId) {
          return {
            output: toolFail(
              toolName,
              "INVALID_BLOG_POST",
              "report_path must be a known Gatehouse blog markdown (lead report, architect summary, root delivery, node retro, or domain skill)",
              { report_path: reportRel },
            ),
            ...toolMetadata(toolName),
          }
        }
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender) {
          return {
            output: toolFail(toolName, "NOT_REGISTERED", "Session is not registered in Gatehouse registry"),
            ...toolMetadata(toolName),
          }
        }
        const actor = sender.profile ?? sender.scope
        const result = await unpublishBlogPost(input.directory, { postId, actor })
        if (!result.ok) {
          if (result.code === "NOT_PUBLISHED") {
            return {
              output: toolFail(toolName, "NOT_PUBLISHED", `Post is not published: ${reportRel}`),
              ...toolMetadata(toolName),
            }
          }
          if (result.code === "NO_OWNER") {
            return {
              output: toolFail(
                toolName,
                "NO_OWNER",
                "This post has no published_by metadata; unpublish is not allowed",
              ),
              ...toolMetadata(toolName),
            }
          }
          return {
            output: toolFail(
              toolName,
              "NOT_AUTHORIZED",
              `Only the publisher may unpublish (published_by=${result.published_by}, you=${actor})`,
            ),
            ...toolMetadata(toolName),
          }
        }
        return {
          output: toolOk(toolName, {
            ...result,
            note: "Post is hidden from Portal blog view on next poll",
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "UNPUBLISH_BLOG_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
