import { tool, type PluginInput } from "@opencode-ai/plugin"
import { retroSessionTitle, retroNodeReportRelPath, resolveProjectPath } from "../paths.ts"
import { childNodeIds, managerRetroOrder } from "../tree/parse.ts"
import { getRegistryStore } from "../registry/context.ts"
import { readManifest, readTeamSpecFile, writeRetroManifest } from "../tree/store.ts"
import { forkSession } from "../session/client.ts"
import { dumpMissionContext } from "../session/context-dump.ts"
import { readMissionsDocument, setMissionStatus } from "../missions/store.ts"
import { assertAllMissionAgentsIdle, requireLeadCaller, requireMission } from "../missions/lifecycle.ts"
import { requireActiveMissionId, requireSenderMissionId } from "../missions/scope.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function missionRetroTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: start mission retro after user acceptance. Requires active mission running in missions.yaml, manifest present, and all inner exec sessions idle. Forks retro sessions, dumps context/, kickoffs retro analysis + domain skill-extract (only exec nodes with manifest skill_domain receive skill-extract), sets missions.yaml to retro.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_mission_retro"
      try {
        const lead = await requireLeadCaller(input, context)
        if (!lead) {
          return {
            output: toolFail(toolName, "NOT_LEAD", "Only profile lead may call gatehouse_mission_retro"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = requireActiveMissionId(lead.registry)

        const missionsDoc = await readMissionsDocument(input.directory)
        const mission = requireMission(missionsDoc, missionId)
        if (mission.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "MISSION_NOT_RUNNING",
              `Mission ${missionId} must be running to start retro (current: ${mission.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const manifest = await readManifest(input.directory, missionId)
        if (!manifest) {
          return {
            output: toolFail(toolName, "MANIFEST_NOT_FOUND", `No manifest for mission ${missionId}`),
            ...toolMetadata(toolName),
          }
        }

        if (manifest.status !== "running") {
          return {
            output: toolFail(
              toolName,
              "MANIFEST_NOT_RUNNING",
              `Manifest for ${missionId} is not running (current: ${manifest.status})`,
            ),
            ...toolMetadata(toolName),
          }
        }

        await assertAllMissionAgentsIdle({
          registry: lead.registry,
          client: input.client,
          directory: input.directory,
          plugin: input,
          missionId,
          scopes: ["inner"],
        })
        const retroOrder = managerRetroOrder(manifest)
        const nodes: import("../tree/types.ts").RetroManifest["nodes"] = {}
        for (const nodeId of retroOrder) {
          const execNode = manifest.nodes[nodeId]
          if (!execNode) continue
          nodes[nodeId] = {
            exec_session_id: execNode.session_id,
            retro_session_id: await forkSession(
              input.client,
              input.directory,
              execNode.session_id,
              retroSessionTitle(manifest.mission_id, nodeId),
            ),
            child_nodes: childNodeIds(manifest, nodeId),
          }
        }
        const retro = {
          mission_id: manifest.mission_id,
          created_at: new Date().toISOString(),
          nodes,
          retro_order: retroOrder,
        }
        await writeRetroManifest(input.directory, retro)
        const registry = await getRegistryStore(input)
        registry.syncRetroFromManifest(retro, manifest)
        registry.beginRetroRun(manifest.mission_id, retroOrder)
        const contextDump = await dumpMissionContext({
          client: input.client,
          projectDirectory: input.directory,
          manifest,
        })
        registry.syncInnerFromManifest(manifest)
        const spec = await readTeamSpecFile(input.directory, missionId)
        const [kickoffs, skillKickoffs] = await Promise.all([
          registry.kickoffRetroSessions(manifest, retroOrder),
          registry.kickoffExecSkillExtraction(manifest, { spec }),
        ])
        await registry.flushPendingDeliveries()
        await setMissionStatus(input.directory, manifest.mission_id, "retro")
        registry.syncMissionRegistryStatus(manifest.mission_id, "retro")
        return {
          output: toolOk(toolName, {
            mission_id: manifest.mission_id,
            retro_order: retroOrder,
            forked: Object.keys(nodes).length,
            context_dump: contextDump,
            kickoffs,
            skill_kickoffs: skillKickoffs,
            note: "各 retro session 完成后须 gatehouse_retro_record（报告含工具贡献）；context/ 含 messages、timeline、metrics 与 subtree-metrics；语义特征提取靠 retro-toolkit 脚本",
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "MISSION_RETRO_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function retroRecordTool(input: PluginInput) {
  return tool({
    description:
      "Record retro analysis completion in registry.db (retro session only). When all expected nodes are recorded, Gatehouse auto-messages profile architect to read reports.",
    args: {
      report_path: tool.schema
        .string()
        .optional()
        .describe("Default: .gatehouse/trees/<mission_id>/reports/nodes/<node_id>-retro.md"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_retro_record"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "retro") {
          return {
            output: toolFail(toolName, "NOT_RETRO_SESSION", "Only retro fork sessions may call gatehouse_retro_record"),
            ...toolMetadata(toolName),
          }
        }
        const missionId = requireSenderMissionId(sender)
        const nodeId = sender.nodeId
        if (!nodeId) {
          return {
            output: toolFail(toolName, "MISSING_NODE_ID", "Retro session is not bound to a registry node"),
            ...toolMetadata(toolName),
          }
        }
        const retroRun = registry.retroStatus(missionId)
        if (retroRun.status !== "ok" || !retroRun.run.expectedNodeIds.includes(nodeId)) {
          return {
            output: toolFail(
              toolName,
              "NODE_NOT_IN_RETRO_RUN",
              `Node ${nodeId} is not in the active retro run for mission ${missionId}`,
              retroRun.status === "ok" ? { expected: retroRun.run.expectedNodeIds } : undefined,
            ),
            ...toolMetadata(toolName),
          }
        }
        const reportRel = args.report_path ?? retroNodeReportRelPath(missionId, nodeId)
        const reportAbs = resolveProjectPath(input.directory, reportRel)
        if (!(await Bun.file(reportAbs).exists())) {
          return {
            output: toolFail(toolName, "REPORT_NOT_FOUND", `Report file missing: ${reportRel}`, {
              expected: reportRel,
            }),
            ...toolMetadata(toolName),
          }
        }
        await registry.recordRetroCompletion({
          missionId,
          nodeId,
          sessionId: context.sessionID,
          reportPath: reportRel,
        })
        const status = registry.retroStatus(missionId)
        return {
          output: toolOk(toolName, {
            mission_id: missionId,
            node_id: nodeId,
            report_path: reportRel,
            retro_status: status.status === "ok" ? {
              completed: status.completed,
              pending: status.pending,
              all_done: status.allDone,
              architect_notified: status.architectNotified,
            } : status,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { output: toolFail(toolName, "RETRO_RECORD_FAILED", message), ...toolMetadata(toolName) }
      }
    },
  })
}
