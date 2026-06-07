import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { resolveProjectPath } from "../paths.ts"
import { curatorSkillSummaryRelPath } from "../paths.ts"
import { requireSenderMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function skillExtractRecordTool(input: PluginInput) {
  return tool({
    description:
      "Record exec-session domain skill extraction completion in registry.db. When all expected nodes are recorded, Gatehouse auto-messages profile curator to reorganize skills.",
    args: {
      summary_path: tool.schema
        .string()
        .optional()
        .describe("Default: .gatehouse/trees/<mission_id>/reports/skills/<node_id>-extract.md"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_skill_extract_record"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "inner") {
          return {
            output: toolFail(toolName, "NOT_EXEC_SESSION", "Only inner exec sessions may call gatehouse_skill_extract_record"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = requireSenderMissionId(sender)
        const nodeId = sender.nodeId
        if (!nodeId) {
          return {
            output: toolFail(toolName, "MISSING_NODE_ID", "Exec session is not bound to a registry node"),
            ...toolMetadata(toolName),
          }
        }
        const skillExtractRun = registry.skillExtractStatus(missionId)
        if (skillExtractRun.status !== "ok" || !skillExtractRun.run.expectedNodeIds.includes(nodeId)) {
          return {
            output: toolFail(
              toolName,
              "NODE_NOT_IN_SKILL_EXTRACT_RUN",
              `Node ${nodeId} has no skill extract kickoff for mission ${missionId}`,
              skillExtractRun.status === "ok" ? { expected: skillExtractRun.run.expectedNodeIds } : undefined,
            ),
            ...toolMetadata(toolName),
          }
        }
        const summaryRel = args.summary_path ?? curatorSkillSummaryRelPath(missionId, nodeId)
        const summaryAbs = resolveProjectPath(input.directory, summaryRel)
        if (!(await Bun.file(summaryAbs).exists())) {
          return {
            output: toolFail(toolName, "SUMMARY_NOT_FOUND", `Summary file missing: ${summaryRel}`, {
              expected: summaryRel,
            }),
            ...toolMetadata(toolName),
          }
        }
        await registry.recordSkillExtractCompletion({
          missionId,
          nodeId,
          sessionId: context.sessionID,
          summaryPath: summaryRel,
        })
        const status = registry.skillExtractStatus(missionId)
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            node_id: nodeId,
            summary_path: summaryRel,
            skill_extract_status: status.status === "ok" ? {
              completed: status.completed,
              pending: status.pending,
              all_done: status.allDone,
              curator_notified: status.curatorNotified,
            } : status,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "SKILL_EXTRACT_RECORD_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
