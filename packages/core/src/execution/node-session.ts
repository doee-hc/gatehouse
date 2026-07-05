import type { PluginInput } from "@opencode-ai/plugin"
import { formatAcceptanceBranchSnapshot } from "../dispatch/team-snapshot.ts"
import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { readLocaleSync } from "../locale.ts"
import type { MissionContract } from "../missions/contract.ts"
import type { RegistryStore } from "../registry/store.ts"
import { innerAgentId } from "../registry/types.ts"
import { promptSession } from "../session/client.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan-types.ts"
import { planChildNodeIds } from "../orchestration/plan-graph.ts"
import { skillDomainContextNote } from "../retro/skill-kickoff.ts"
import { selectSkillsForTask, formatRetrievedSkillCatalog } from "../skills/retrieval.ts"
import type { OuterProfile } from "../names.ts"
import { formatMissionContextBlock } from "./context.ts"
import { formatNodeBriefBlock } from "./brief.ts"
import type { NodeBrief } from "./types.ts"

export function formatNodeRoleBlock(nodeId: string, description: string, locale: GatehouseLocale) {
  const lines = [
    gatehouseMessage("execution.nodeRole.header", locale, { node_id: nodeId }),
    "",
    gatehouseMessage("execution.nodeRole.description", locale, { description: description.trim() }),
    "",
    gatehouseMessage("execution.nodeRole.briefHint", locale),
  ]
  return lines.join("\n")
}

export function buildInnerBootstrapSystem(input: {
  nodeId: string
  description: string
  locale: GatehouseLocale
  contract?: MissionContract
  acceptanceBranchSnapshot?: string
  skillDomainNote?: string
  brief?: NodeBrief
}) {
  const parts = [formatNodeRoleBlock(input.nodeId, input.description, input.locale)]
  if (input.skillDomainNote?.trim()) parts.push(input.skillDomainNote.trim())
  if (input.acceptanceBranchSnapshot?.trim()) parts.push(input.acceptanceBranchSnapshot.trim())
  if (input.contract) parts.push(formatMissionContextBlock(input.contract, input.locale))
  if (input.brief) parts.push(formatNodeBriefBlock(input.brief, input.locale))
  return parts.join("\n\n")
}

export async function buildBootstrapSystemForNode(input: {
  projectDirectory: string
  spec: MissionTeamSpec
  plan: OrchestrationPlan
  nodeId: string
  contract?: MissionContract
  agentNames: Record<OuterProfile, string>
  brief?: NodeBrief
}) {
  const specNode = input.spec.nodes[input.nodeId]
  if (!specNode) throw new Error(`MissionTeamSpec missing node ${input.nodeId}`)

  const locale = readLocaleSync(input.projectDirectory)
  const retrievalQuery = [
    specNode.description,
    input.brief?.role,
    ...(input.brief?.your_work ?? []),
    ...(input.brief?.acceptance_slice ?? []),
  ]
    .filter(Boolean)
    .join(" ")
  const skillEntries = specNode.skill_domain
    ? await selectSkillsForTask({
        projectDirectory: input.projectDirectory,
        domain: specNode.skill_domain,
        query: retrievalQuery,
        missionId: input.spec.mission_id,
      })
    : []
  const skillCatalog = formatRetrievedSkillCatalog(skillEntries, locale === "zh" ? "zh" : "en")
  const skillDomainNote = specNode.skill_domain
    ? skillDomainContextNote(specNode.skill_domain, input.agentNames, locale, skillCatalog)
    : undefined

  const isAcceptanceLayerNode = planChildNodeIds(input.plan, input.nodeId).length > 0
  const acceptanceBranchSnapshot = isAcceptanceLayerNode
    ? formatAcceptanceBranchSnapshot(input.spec, input.plan, input.nodeId, locale)
    : undefined

  return buildInnerBootstrapSystem({
    nodeId: input.nodeId,
    description: specNode.description,
    locale,
    ...(input.contract && { contract: input.contract }),
    ...(acceptanceBranchSnapshot && { acceptanceBranchSnapshot }),
    ...(skillDomainNote && { skillDomainNote }),
    ...(input.brief && { brief: input.brief }),
  })
}

export async function deliverNodeBriefSystemPrompt(input: {
  plugin: PluginInput
  store: RegistryStore
  missionId: string
  nodeId: string
  brief: NodeBrief
}) {
  const recipient = input.store.byAgentId(innerAgentId(input.missionId, input.nodeId))
  if (!recipient) return { status: "skipped" as const, reason: "node_not_in_registry" }

  const locale = readLocaleSync(input.plugin.directory)
  await promptSession(
    input.plugin.client,
    input.plugin.directory,
    recipient.sessionId,
    {
      profile: recipient.profile,
      system: formatNodeBriefBlock(input.brief, locale),
      noReply: true,
    },
    input.plugin,
  )
  return { status: "sent" as const, locale }
}
