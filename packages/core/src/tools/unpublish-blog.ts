import { tool, type PluginInput } from "@opencode-ai/plugin"
import { buildCriteriaForMission, readDeliveryDocument } from "../delivery/store.ts"
import {
  deliverableBlogPostId,
  isUnderProjectRoot,
  normalizeProjectRelPath,
  resolveSkillBlogPostId,
} from "../delivery/publish-policy.ts"
import { BLOG_PUBLISHER_LEAD, readBlogPublishedDocument, unpublishBlogPost } from "../portal/blog-publish.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { requireMission } from "../missions/lifecycle.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { getRegistryStore } from "../registry/context.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function normalizeReportPath(reportPath: string) {
  return reportPath.replace(/\\/g, "/").replace(/^\.\//, "")
}

async function resolveUnpublishPostId(input: {
  projectDirectory: string
  missionId?: string
  relPath: string
  criteria: { publishPath?: string }[]
}) {
  const skillId = resolveSkillBlogPostId(input.relPath)
  if (skillId) return skillId
  const normalized = normalizeProjectRelPath(input.relPath)
  const published = await readBlogPublishedDocument(input.projectDirectory)
  const publishedEntry = published.posts.find((entry) => normalizeProjectRelPath(entry.path) === normalized)
  if (publishedEntry) return publishedEntry.id

  if (!input.missionId) return undefined
  const allowedByCriteria = input.criteria.some(
    (item) => item.publishPath && normalizeProjectRelPath(item.publishPath) === normalized,
  )
  if (allowedByCriteria) return deliverableBlogPostId(input.missionId, normalized)

  const delivery = await readDeliveryDocument(input.projectDirectory, input.missionId)
  const publishedArtifacts = delivery?.active?.published_artifacts ?? []
  if (publishedArtifacts.some((item) => normalizeProjectRelPath(item) === normalized)) {
    return deliverableBlogPostId(input.missionId, normalized)
  }
  return undefined
}

export function unpublishBlogTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: unpublish a Portal post (deliverable or domain SKILL). Pass the same report_path used when the post was published.",
    args: {
      mission_id: tool.schema.string().optional().describe("Mission id for deliverable paths"),
      report_path: tool.schema
        .string()
        .min(1)
        .describe("Project-relative markdown path used when publishing"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_unpublish_blog"
      try {
        const reportRel = normalizeReportPath(args.report_path)
        if (!isUnderProjectRoot(input.directory, reportRel)) {
          return {
            output: toolFail(toolName, "PATH_OUTSIDE_PROJECT", `Path must be inside project: ${reportRel}`),
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
        if (sender.profile !== BLOG_PUBLISHER_LEAD) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_unpublish_blog"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = args.mission_id ?? sender?.missionId
        let criteria: { publishPath?: string }[] = []
        if (missionId) {
          const missionsDoc = await readMissionsDocument(input.directory)
          const mission = requireMission(missionsDoc, missionId)
          criteria = await buildCriteriaForMission(input.directory, missionId, mission)
        }
        const postId = await resolveUnpublishPostId({
          projectDirectory: input.directory,
          missionId,
          relPath: reportRel,
          criteria,
        })
        if (!postId) {
          return {
            output: toolFail(
              toolName,
              "INVALID_BLOG_POST",
              "report_path must be a published deliverable (done_when publish:) or domain SKILL.md",
              { report_path: reportRel },
            ),
            ...toolMetadata(toolName),
          }
        }
        const actor = BLOG_PUBLISHER_LEAD
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
