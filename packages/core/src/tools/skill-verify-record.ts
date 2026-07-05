import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { resolveProjectPath } from "../paths.ts"
import { skillVerifyReportRelPath } from "../paths.ts"
import { requireSenderMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"
import { parseSkillPathsFromExtractSummary, runProgrammaticVerifier } from "../skills/quality-gate.ts"
import { recordSkillVerifyPass } from "../skills/utility.ts"
import { readExtractManifest } from "../missions/manifest/store.ts"
import { dumpPhaseSessionMetrics } from "../session/context-dump.ts"
import type { GatehouseClient } from "../session/client.ts"

export function skillVerifyRecordTool(input: PluginInput) {
  return tool({
    description:
      "Record skill verifier session completion (build-verify only). Runs programmatic checks; passed=false returns VERIFY_FAILED without recording. When all expected nodes pass, Gatehouse auto-notifies profile curator.",
    args: {
      passed: tool.schema.boolean().describe("Whether verification passed after any required fixes"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_skill_verify_record"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "verify") {
          return {
            output: toolFail(toolName, "NOT_VERIFY_SESSION", "Only verify sessions may call gatehouse_skill_verify_record"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = requireSenderMissionId(sender)
        const nodeId = sender.nodeId
        if (!nodeId) {
          return {
            output: toolFail(toolName, "MISSING_NODE_ID", "Verify session is not bound to a registry node"),
            ...toolMetadata(toolName),
          }
        }
        const verifyRun = registry.skillVerifyStatus(missionId)
        if (verifyRun.status !== "ok" || !verifyRun.run.expectedNodeIds.includes(nodeId)) {
          return {
            output: toolFail(
              toolName,
              "NODE_NOT_IN_VERIFY_RUN",
              `Node ${nodeId} has no verify kickoff for mission ${missionId}`,
            ),
            ...toolMetadata(toolName),
          }
        }
        const reportRel = skillVerifyReportRelPath(missionId, nodeId)
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Verify report missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }

        const extract = await readExtractManifest(input.directory, missionId)
        const skillDomain = extract?.nodes[nodeId]?.skill_domain
        const extractSummaryRel = `.gatehouse/missions/${missionId}/reports/skills/${nodeId}-extract.md`
        const extractSummary = await Bun.file(resolveProjectPath(input.directory, extractSummaryRel)).text().catch(() => "")
        const skillPaths = skillDomain ? parseSkillPathsFromExtractSummary(extractSummary, skillDomain) : []
        const programmatic = skillDomain
          ? await runProgrammaticVerifier({ projectDirectory: input.directory, domain: skillDomain, skillRelPaths: skillPaths })
          : { ok: true, issues: [] }

        const passed = args.passed && programmatic.ok
        if (!passed) {
          return {
            output: toolFail(toolName, "VERIFY_FAILED", "Verification failed", {
              programmatic_issues: programmatic.issues,
              agent_passed: args.passed,
            }),
            ...toolMetadata(toolName),
          }
        }

        if (skillDomain) {
          for (const relPath of skillPaths) {
            const slug = relPath.split("/").slice(-2, -1)[0]
            if (slug) await recordSkillVerifyPass({ projectDirectory: input.directory, domain: skillDomain, slug })
          }
        }

        await registry.recordSkillVerifyCompletion({
          missionId,
          nodeId,
          sessionId: context.sessionID,
          passed: true,
          reportPath: reportRel,
        })
        await dumpPhaseSessionMetrics({
          client: input.client as GatehouseClient,
          projectDirectory: input.directory,
          missionId,
          phase: "verify",
          nodeId,
          sessionId: context.sessionID,
        }).catch(() => undefined)
        const status = registry.skillVerifyStatus(missionId)
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            node_id: nodeId,
            ...(status.status === "ok" && {
              all_done: status.allDone,
              remaining: status.pending.length,
            }),
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "SKILL_VERIFY_RECORD_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
