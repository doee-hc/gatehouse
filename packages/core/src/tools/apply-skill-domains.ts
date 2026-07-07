import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { readMissionManifest, writeMissionManifest } from "../missions/manifest/store.ts"
import { resolveTeamSource } from "../orchestration/script/resolve-team.ts"
import { bootstrapMission } from "../missions/bootstrap.ts"
import { skillDomainContextNote } from "../retro/skill-kickoff.ts"
import { selectSkillsForTask, formatRetrievedSkillCatalog } from "../skills/retrieval.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync } from "../names.ts"
import { innerAgentId } from "../registry/types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { ensureSkillDomainDirs, skillDomainIdsFromAssignments } from "../skills/ensure-domain-dirs.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function applySkillDomainsTool(input: PluginInput) {
  return tool({
    description:
      "profile curator only: assign skill_domain on execution nodes for the active Mission. Creates missing `.gatehouse/skills/by-domain/<domain-id>/` dirs (no SKILL.md). Call after architect gatehouse_submit_orchestration.",
    args: {
      assignments: tool.schema
        .record(tool.schema.string(), tool.schema.string())
        .describe('Map node_id to domain-id for nodes that need a domain'),
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
        const assignments = args.assignments

        await ensureSkillDomainDirs(input.directory, skillDomainIdsFromAssignments(assignments))

        const manifest = await readMissionManifest(input.directory, missionId)
        if (!manifest) {
          const resolved = await resolveTeamSource(input.directory, missionId)
          if (!resolved) {
            return {
              output: toolFail(toolName, "MISSION_SCRIPT_NOT_FOUND", "No mission.script.ts for active mission"),
              ...toolMetadata(toolName),
            }
          }
          const spec = structuredClone(resolved.spec)
          for (const [nodeId, domainValue] of Object.entries(assignments)) {
            if (!domainValue.trim()) continue
            const node = spec.nodes[nodeId]
            if (!node) {
              return {
                output: toolFail(toolName, "UNKNOWN_NODE", `Execution team has no node ${nodeId}`),
                ...toolMetadata(toolName),
              }
            }
            node.skill_domain = domainValue.trim()
          }
          const contract = readActiveMissionContract(input.directory, missionId)
          const bootstrap = await bootstrapMission(input, spec, {
            objective: contract?.objective,
          })
          return {
            output: toolOk(toolName, {
              phase: "bootstrapped",
              mission_id: missionId,
              applied: Object.keys(assignments).length,
              node_count: bootstrap.node_count,
            }),
            ...toolMetadata(toolName),
          }
        }

        const resolvedTeam = await resolveTeamSource(input.directory, missionId)
        const locale = readLocaleSync(input.directory)
        const agentNames = readAgentNamesSync(input.directory)

        let delivered = 0
        for (const [nodeId, domainValue] of Object.entries(assignments)) {
          if (!domainValue.trim()) continue
          const node = manifest.nodes[nodeId]
          if (!node) continue
          node.skill_domain = domainValue.trim()
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

        await writeMissionManifest(input.directory, manifest)
        registry.syncInnerFromManifest(manifest)
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
