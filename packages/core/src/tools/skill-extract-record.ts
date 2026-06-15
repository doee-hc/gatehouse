import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { resolveProjectPath } from "../paths.ts"
import { curatorSkillSummaryRelPath } from "../paths.ts"
import { requireSenderMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { runSkillQualityGate } from "../skills/quality-gate.ts"
import { recordSkillExtract } from "../skills/utility.ts"
import { readExtractManifest } from "../tree/store.ts"

export function skillExtractRecordTool(input: PluginInput) {
  return tool({
    description:
      "Record extract-session domain skill extraction completion. Runs quality gates before accept. When all nodes complete, Gatehouse starts verify sessions.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_skill_extract_record"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "extract") {
          return {
            output: toolFail(toolName, "NOT_EXTRACT_SESSION", "Only extract sessions may call gatehouse_skill_extract_record"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = requireSenderMissionId(sender)
        const nodeId = sender.nodeId
        if (!nodeId) {
          return {
            output: toolFail(toolName, "MISSING_NODE_ID", "Extract session is not bound to a registry node"),
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
        const summaryRel = curatorSkillSummaryRelPath(missionId, nodeId)
        const summaryAbs = resolveProjectPath(input.directory, summaryRel)
        if (!(await Bun.file(summaryAbs).exists())) {
          return {
            output: toolFail(toolName, "SUMMARY_NOT_FOUND", `Summary file missing: ${summaryRel}`, {
              expected: summaryRel,
            }),
            ...toolMetadata(toolName),
          }
        }

        const extractManifest = await readExtractManifest(input.directory, missionId)
        const skillDomain = extractManifest?.nodes[nodeId]?.skill_domain
        if (!skillDomain) {
          return {
            output: toolFail(toolName, "SKILL_DOMAIN_MISSING", `No skill_domain for extract node ${nodeId}`),
            ...toolMetadata(toolName),
          }
        }

        const summaryMarkdown = await Bun.file(summaryAbs).text()
        const gate = await runSkillQualityGate({
          projectDirectory: input.directory,
          missionId,
          nodeId,
          domain: skillDomain,
          summaryMarkdown,
        })
        if (!gate.ok) {
          return {
            output: toolFail(toolName, "QUALITY_GATE_FAILED", "Skill quality gate rejected submission", {
              issues: gate.issues,
            }),
            ...toolMetadata(toolName),
          }
        }

        for (const relPath of gate.new_skill_paths) {
          const slug = relPath.split("/").slice(-2, -1)[0]
          if (slug) {
            await recordSkillExtract({
              projectDirectory: input.directory,
              domain: skillDomain,
              slug,
              missionId,
            })
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
            skill_paths: gate.new_skill_paths.length,
            ...(status.status === "ok" && {
              all_done: status.allDone,
              remaining: status.pending.length,
            }),
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
