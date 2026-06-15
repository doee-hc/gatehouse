import { tool, type PluginInput } from "@opencode-ai/plugin"
import { retroSessionTitle, retroNodeReportRelPath, resolveProjectPath } from "../paths.ts"
import { childNodeIds, managerRetroOrder } from "../tree/parse.ts"
import { getRegistryStore } from "../registry/context.ts"
import {
  readManifest,
  readRetroManifest,
  writeRetroManifest,
  writeExtractManifest,
} from "../tree/store.ts"
import type { RetroManifest } from "../tree/types.ts"
import type { RegistryStore } from "../registry/store.ts"
import { createExtractManifest } from "../extract/setup.ts"
import { resolveTeamSource } from "../orchestration/resolve-team.ts"
import { createSession } from "../session/client.ts"
import { INNER_EXECUTION_AGENT } from "../registry/types.ts"
import { dumpMissionContext } from "../session/context-dump.ts"
import { readMissionsDocument, setMissionStatus } from "../missions/store.ts"
import { requireLeadCaller, requireMission, waitForAllMissionAgentsIdle } from "../missions/lifecycle.ts"
import { requireActiveMissionId, requireSenderMissionId } from "../missions/scope.ts"
import { deliveryIsSubmitted, readDeliveryDocument } from "../delivery/store.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

function retroAlreadyStartedResponse(
  toolName: string,
  missionId: string,
  retro: RetroManifest,
  registry: RegistryStore,
) {
  const retroStatus = registry.retroStatus(missionId)
  return {
    output: toolOk(toolName, {
      mission_id: missionId,
      retro_sessions: Object.keys(retro.nodes).length,
      already_started: true,
      ...(retroStatus.status === "ok" && {
        all_done: retroStatus.allDone,
        remaining: retroStatus.pending.length,
      }),
    }),
    ...toolMetadata(toolName),
  }
}

export function missionRetroTool(input: PluginInput) {
  return tool({
    description:
      "profile lead only: start mission retro after user confirms delivery in chat. Requires delivery recorded (structural root finished all nodes), active mission running in missions.yaml, manifest present, and all inner exec sessions idle. Forks retro sessions, dumps context/, creates isolated build-extract sessions for nodes with skill_domain, and kickoffs retro + skill-extract. Sets missions.yaml to retro. Portal publish happens on gatehouse_mission_complete(done).",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_mission_retro"
      let retroStatusCommittedMissionId: string | undefined
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

        const existingRetro = await readRetroManifest(input.directory, missionId)
        if (mission.status === "retro") {
          if (existingRetro) {
            return retroAlreadyStartedResponse(toolName, missionId, existingRetro, lead.registry)
          }
          return {
            output: toolFail(
              toolName,
              "RETRO_MANIFEST_MISSING",
              `Mission ${missionId} is retro but retro manifest is missing`,
            ),
            ...toolMetadata(toolName),
          }
        }

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

        if (existingRetro) {
          await setMissionStatus(input.directory, missionId, "retro")
          lead.registry.syncMissionRegistryStatus(missionId, "retro")
          return retroAlreadyStartedResponse(toolName, missionId, existingRetro, lead.registry)
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

        const deliveryDoc = await readDeliveryDocument(input.directory, missionId)
        if (!deliveryIsSubmitted(deliveryDoc)) {
          return {
            output: toolFail(
              toolName,
              "DELIVERY_NOT_SUBMITTED",
              `Mission ${missionId} delivery must be recorded via structural root gatehouse_execution_complete before retro`,
              deliveryDoc?.active
                ? { delivery_version: deliveryDoc.active.version, status: deliveryDoc.active.status }
                : undefined,
            ),
            ...toolMetadata(toolName),
          }
        }

        await waitForAllMissionAgentsIdle({
          registry: lead.registry,
          client: input.client,
          directory: input.directory,
          plugin: input,
          missionId,
          scopes: ["inner"],
        })

        await setMissionStatus(input.directory, missionId, "retro")
        retroStatusCommittedMissionId = missionId
        const registry = await getRegistryStore(input)
        registry.syncMissionRegistryStatus(missionId, "retro")

        const retroOrder = managerRetroOrder(manifest)
        const nodes: import("../tree/types.ts").RetroManifest["nodes"] = {}
        for (const nodeId of retroOrder) {
          const execNode = manifest.nodes[nodeId]
          if (!execNode) continue
          nodes[nodeId] = {
            exec_session_id: execNode.session_id,
            retro_session_id: await createSession(input.client, input.directory, {
              display_name: retroSessionTitle(manifest.mission_id, nodeId),
              profile: execNode.profile ?? INNER_EXECUTION_AGENT,
            }),
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
        registry.syncRetroFromManifest(retro, manifest)
        registry.beginRetroRun(manifest.mission_id, retroOrder)
        await dumpMissionContext({
          client: input.client,
          projectDirectory: input.directory,
          manifest,
        })
        registry.syncInnerFromManifest(manifest)
        const resolved = await resolveTeamSource(input.directory, missionId)
        if (!resolved) {
          return {
            output: toolFail(
              toolName,
              "TEAM_NOT_FOUND",
              `No mission.script.ts for mission ${missionId}`,
            ),
            ...toolMetadata(toolName),
          }
        }
        const spec = resolved.spec
        const extract = await createExtractManifest({
          client: input.client,
          projectDirectory: input.directory,
          manifest,
          spec,
        })
        await writeExtractManifest(input.directory, extract)
        registry.syncExtractFromManifest(extract, manifest)
        await Promise.all([
          registry.kickoffRetroSessions(manifest, retroOrder),
          registry.kickoffExtractSkillSessions(extract),
        ])
        await registry.flushPendingDeliveries()
        return {
          output: toolOk(toolName, {
            mission_id: manifest.mission_id,
            retro_sessions: Object.keys(nodes).length,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "MISSION_RETRO_FAILED"
        if (retroStatusCommittedMissionId) {
          try {
            const retroWritten = await readRetroManifest(input.directory, retroStatusCommittedMissionId)
            if (!retroWritten) {
              await setMissionStatus(input.directory, retroStatusCommittedMissionId, "running")
              const registry = await getRegistryStore(input)
              registry.syncMissionRegistryStatus(retroStatusCommittedMissionId, "running")
            }
          } catch {
            // Best-effort rollback when retro failed before manifest was written.
          }
        }
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}

export function retroRecordTool(input: PluginInput) {
  return tool({
    description:
      "Record retro analysis completion (retro session only). Writes to the default report path for your node. When all expected nodes are recorded, Gatehouse auto-messages profile architect to read reports.",
    args: {},
    async execute(_args, context) {
      const toolName = "gatehouse_retro_record"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "retro") {
          return {
            output: toolFail(toolName, "NOT_RETRO_SESSION", "Only retro sessions may call gatehouse_retro_record"),
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
        const reportRel = retroNodeReportRelPath(missionId, nodeId)
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
            ...(status.status === "ok" && {
              all_done: status.allDone,
              remaining: status.pending.length,
            }),
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
