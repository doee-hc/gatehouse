import { tool, type PluginInput } from "@opencode-ai/plugin"
import { getRegistryStore } from "../registry/context.ts"
import { readManifest, writeManifest } from "../tree/store.ts"
import { resolveTeamSource } from "../orchestration/resolve-team.ts"
import { runBootstrapTree } from "../tree/bootstrap-run.ts"
import { skillDomainContextNote, listSkillSlugsInDomain } from "../retro/skill-kickoff.ts"
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
      "profile curator only: assign skill_domain on execution nodes for the active Mission. Creates missing `.gatehouse/skills/by-domain/<domain-id>/` dirs (no SKILL.md). Call after architect gatehouse_bootstrap_tree.",
    args: {
      assignments: tool.schema
        .string()
        .describe('JSON object: { "<node_id>": "<domain-id>", ... } — include only nodes that need a domain'),
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
          const resolved = await resolveTeamSource(input.directory, missionId)
          if (!resolved) {
            return {
              output: toolFail(toolName, "MISSION_SCRIPT_NOT_FOUND", "No mission.script.ts for active mission"),
              ...toolMetadata(toolName),
            }
          }
          const spec = structuredClone(resolved.spec)
          for (const [nodeId, domainValue] of Object.entries(parsed)) {
            if (typeof domainValue !== "string" || !domainValue.trim()) continue
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
          const slugs = await listSkillSlugsInDomain(input.directory, domainValue.trim())
          const result = await registry.deliverSystemMessage(
            recipient,
            skillDomainContextNote(
              domainValue.trim(),
              readAgentNamesSync(input.directory),
              readLocaleSync(input.directory),
              slugs,
            ),
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
