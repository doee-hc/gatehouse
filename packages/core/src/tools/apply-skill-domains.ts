import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { readMissionManifest, writeMissionManifest } from "../missions/manifest/store.ts"
import { resolveTeamSource } from "../orchestration/script/resolve-team.ts"
import { skillDomainContextNote } from "../retro/skill-kickoff.ts"
import { selectSkillsForTask, formatRetrievedSkillCatalog } from "../skills/retrieval.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync } from "../names.ts"
import { innerAgentId } from "../registry/types.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { parseSkillDomainAssignments } from "../skills/parse-assignments.ts"
import { readSkillDomainsRegistry, unknownSkillDomainIds } from "../skills/domains.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { requireMission } from "../missions/lifecycle.ts"
import { appendExtractNodesForAssignments } from "../extract/retro-assignments.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function applySkillDomainsTool(input: PluginInput) {
  return tool({
    description:
      "profile curator only: assign skill_domain on execution nodes using existing ids from domains.yaml. During retro, starts extract sessions for newly assigned nodes. During execution, injects skill catalog into assigned inner nodes.",
    args: {
      assignments: tool.schema
        .array(
          tool.schema.object({
            node_id: tool.schema.string().describe("execution node id from mission.script team"),
            domain_id: tool.schema.string().describe("existing skill domain id from domains.yaml"),
          }),
        )
        .describe("skill_domain assignment for each execution node"),
    },
    async execute(args, context) {
      const toolName = "gatehouse_apply_skill_domains"
      try {
        const registry = await getRegistryStore(input)
        const sender = registry.bySession(context.sessionID)
        if (!sender || sender.scope !== "outer" || sender.profile !== "curator") {
          return {
            output: toolFail(toolName, "NOT_CURATOR", "Only profile curator may call gatehouse_apply_skill_domains"),
            ...toolMetadata(toolName),
          }
        }

        const missionId = requireActiveMissionId(registry)
        let assignments: Record<string, string>
        try {
          assignments = parseSkillDomainAssignments(args.assignments)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            output: toolFail(toolName, "INVALID_ASSIGNMENTS", message),
            ...toolMetadata(toolName),
          }
        }

        const registered = await readSkillDomainsRegistry(input.directory)
        const unknown = unknownSkillDomainIds(assignments, registered)
        if (unknown.length > 0) {
          return {
            output: toolFail(
              toolName,
              "UNKNOWN_SKILL_DOMAIN",
              `domain id(s) not in domains.yaml: ${unknown.join(", ")}`,
            ),
            ...toolMetadata(toolName),
          }
        }

        const manifest = await readMissionManifest(input.directory, missionId)
        if (!manifest) {
          return {
            output: toolFail(
              toolName,
              "MANIFEST_NOT_FOUND",
              "Mission manifest missing — architect must call gatehouse_submit_orchestration first",
            ),
            ...toolMetadata(toolName),
          }
        }

        const mission = requireMission(await readMissionsDocument(input.directory), missionId)
        const isRetro = mission.status === "retro"
        const resolvedTeam = await resolveTeamSource(input.directory, missionId)
        const locale = readLocaleSync(input.directory)
        const agentNames = readAgentNamesSync(input.directory)

        for (const [nodeId, domainValue] of Object.entries(assignments)) {
          if (!domainValue.trim()) continue
          const node = manifest.nodes[nodeId]
          if (!node) {
            return {
              output: toolFail(toolName, "UNKNOWN_NODE", `Execution team has no node ${nodeId}`),
              ...toolMetadata(toolName),
            }
          }
          node.skill_domain = domainValue.trim()
        }

        await writeMissionManifest(input.directory, manifest)
        registry.syncInnerFromManifest(manifest)

        if (isRetro) {
          const extract = await appendExtractNodesForAssignments({
            client: input.client,
            projectDirectory: input.directory,
            registry,
            manifest,
            assignments,
          })
          return {
            output: toolOk(toolName, {
              phase: "retro_extract_started",
              mission_id: missionId,
              applied: Object.keys(assignments).length,
              extract_nodes_started: extract.appended,
            }),
            ...toolMetadata(toolName),
          }
        }

        let delivered = 0
        for (const [nodeId, domainValue] of Object.entries(assignments)) {
          if (!domainValue.trim()) continue
          const recipient = registry.byAgentId(innerAgentId(missionId, nodeId))
          if (!recipient) continue
          const specNode = resolvedTeam?.spec.nodes[nodeId]
          const query = specNode?.description ?? nodeId
          const skillEntries = await selectSkillsForTask({
            projectDirectory: input.directory,
            domain: domainValue.trim(),
            query,
            missionId,
          })
          const skillCatalog = formatRetrievedSkillCatalog(skillEntries, locale === "zh" ? "zh" : "en")
          const result = await registry.deliverSystemMessage(
            recipient,
            skillDomainContextNote(domainValue.trim(), agentNames, locale, skillCatalog),
            recipient.profile,
          )
          if (result.status === "sent" || result.status === "queued") delivered += 1
        }
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            phase: "manifest_updated",
            mission_id: missionId,
            applied: Object.keys(assignments).length,
            delivered,
          }),
          ...toolMetadata(toolName),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = message.includes("gatehouse_mission_start") ? "NO_ACTIVE_MISSION" : "APPLY_SKILL_DOMAINS_FAILED"
        return { output: toolFail(toolName, code, message), ...toolMetadata(toolName) }
      }
    },
  })
}
