import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { readManifest, readTeamSpecFile, writeManifest, writeTeamSpec } from "../tree/store.ts"
import { runBootstrapTree } from "../tree/bootstrap-run.ts"
import { skillDomainContextNote } from "../retro/skill-kickoff.ts"
import { readAgentNamesSync } from "../names.ts"
import { innerAgentId } from "../registry/types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { requireActiveMissionId } from "../missions/scope.ts"
import { ensureSkillDomainDirs, skillDomainIdsFromAssignments } from "../skills/ensure-domain-dirs.ts"
import { toolFail, toolMetadata, toolOk } from "./envelope.ts"

export function applySkillDomainsTool(input: PluginInput) {
  return tool({
    description:
      "profile curator only: fill teamspec skill_domain and bootstrap when no manifest exists; update manifest skill_domain and notify inner sessions otherwise. Creates missing `.gatehouse/skills/by-domain/<domain-id>/` dirs (no SKILL.md). Uses the active mission from registry.",
    args: {
      assignments: tool.schema
        .string()
        .describe('JSON 对象：{ "<node_id>": "<domain-id>", ... }；仅列需分配领域的节点'),
      objective: tool.schema.string().optional().describe("Optional one-line objective for trees-index; default from active mission contract"),
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

        const parsed = JSON.parse(args.assignments) as unknown
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return {
            output: toolFail(toolName, "INVALID_ASSIGNMENTS", "assignments must be a JSON object"),
            ...toolMetadata(toolName),
          }
        }

        const domainDirsEnsured = await ensureSkillDomainDirs(
          input.directory,
          skillDomainIdsFromAssignments(parsed as Record<string, unknown>),
        )

        const manifest = await readManifest(input.directory, missionId)
        if (!manifest) {
          const spec = await readTeamSpecFile(input.directory, missionId)
          for (const [nodeId, domainValue] of Object.entries(parsed)) {
            if (typeof domainValue !== "string" || !domainValue.trim()) continue
            const node = spec.nodes[nodeId]
            if (!node) {
              return {
                output: toolFail(toolName, "UNKNOWN_NODE", `TeamSpec has no node ${nodeId}`),
                ...toolMetadata(toolName),
              }
            }
            node.skill_domain = domainValue.trim()
          }
          await writeTeamSpec(input.directory, spec)
          const contract = readActiveMissionContract(input.directory, missionId)
          const bootstrap = await runBootstrapTree(input, spec, {
            objective: args.objective ?? contract?.objective,
          })
          return {
            output: toolOk(toolName, {
              phase: "bootstrapped",
              mission_id: missionId,
              applied: Object.keys(parsed).length,
              domain_dirs_ensured: domainDirsEnsured,
              bootstrap,
            }),
            ...toolMetadata(toolName),
          }
        }

        const deliveries: Array<{ nodeId: string; skillDomain: string; delivery: "sent" | "queued" | "failed"; error?: string }> =
          []
        for (const [nodeId, domainValue] of Object.entries(parsed)) {
          if (typeof domainValue !== "string" || !domainValue.trim()) continue
          const node = manifest.nodes[nodeId]
          if (!node) {
            deliveries.push({ nodeId, skillDomain: domainValue, delivery: "failed", error: "unknown node_id" })
            continue
          }
          node.skill_domain = domainValue.trim()
          const recipient = registry.byAgentId(innerAgentId(missionId, nodeId))
          if (!recipient) {
            deliveries.push({ nodeId, skillDomain: domainValue, delivery: "failed", error: "exec agent not in registry" })
            continue
          }
          const result = await registry.deliverSystemMessage(
            recipient,
            skillDomainContextNote(domainValue.trim(), readAgentNamesSync(input.directory)),
            recipient.profile,
          )
          deliveries.push({
            nodeId,
            skillDomain: domainValue.trim(),
            delivery: result.status,
            ...(result.error && { error: result.error }),
          })
        }

        await writeManifest(input.directory, manifest)
        registry.syncInnerFromManifest(manifest)
        await registry.flushPendingDeliveries()

        return {
          output: toolOk(toolName, {
            phase: "manifest_updated",
            mission_id: missionId,
            applied: Object.keys(parsed).length,
            domain_dirs_ensured: domainDirsEnsured,
            deliveries,
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
