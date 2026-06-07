import { tool, type PluginInput } from "@opencode-ai/plugin"
import { resolveProjectPath } from "../paths.ts"
import { publishBlogPost, resolveBlogPostId } from "../portal/blog-publish.ts"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function normalizeReportPath(reportPath: string) {
  return reportPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function publishBlogTool(input: PluginInput) {
  return tool({
    description:
      "Publish a Gatehouse blog post to Portal UI. Reports/skills exist on disk but stay hidden until this tool is called. Pass the project-relative markdown path you just wrote (report_path).",
    args: {
      report_path: tool.schema
        .string()
        .min(1)
        .describe(
          "Project-relative markdown path (lead report, architect summary, root delivery, node retro, or domain SKILL.md)",
        ),
    },
    async execute(args, context) {
      const toolName = "gatehouse_publish_blog"
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
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Markdown file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }
        const markdown = await Bun.file(reportAbs).text()
        if (!markdown.trim()) {
          return {
            output: toolFail(toolName, "REPORT_EMPTY", `Markdown file is empty: ${reportRel}`),
            ...toolMetadata(toolName),
          }
        }
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        const result = await publishBlogPost(input.directory, {
          postId,
          reportPath: reportRel,
          publishedBy: sender?.profile ?? sender?.scope,
        })
        return {
          output: toolOk(toolName, {
            ...result,
            note: "Post is now visible in Portal blog view (cache refresh requested)",
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "PUBLISH_BLOG_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
