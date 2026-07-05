import type { PluginInput } from "@opencode-ai/plugin"
import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { buildDirectedNotification, gatehouseMessage } from "../i18n.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync } from "../names.ts"
import { innerAgentId } from "../registry/types.ts"
import type { RegistryStore } from "../registry/store.ts"
import { promptSession } from "../session/client.ts"
import {
  assertDependsOnDeliverableReady,
  formatDependsOnStructuredBlock,
  formatDependsOnSummaryBlock,
} from "./completion.ts"
import { deliverableNodeIds, normalizeDependsOn } from "./depends-on.ts"
import { readOrchestrationState } from "./state.ts"
import { runMissingBriefError } from "./run.ts"
import type { PromptInput } from "./types.ts"
import type { TeamSpec } from "../tree/types.ts"

export async function deliverOrchestrationPrompt(input: {
  plugin: PluginInput
  store: RegistryStore
  missionId: string
  nodeId: string
  prompt: PromptInput
  team?: TeamSpec
}) {
  const recipient = input.store.byAgentId(innerAgentId(input.missionId, input.nodeId))
  if (!recipient) return { status: "failed" as const, error: `node not in registry: ${input.nodeId}` }

  const locale = readLocaleSync(input.plugin.directory)
  const profile = recipient.profile

  if (input.prompt.system?.trim()) {
    await promptSession(
      input.plugin.client,
      input.plugin.directory,
      recipient.sessionId,
      { profile, system: input.prompt.system.trim(), noReply: true },
      input.plugin,
    )
  }

  if (!input.prompt.text?.trim()) {
    return { status: "sent" as const }
  }

  if (input.prompt.reply) {
    let activationText = input.prompt.text.trim()
    const dependsOn = normalizeDependsOn(input.prompt.dependsOn)
    const injectDeliverable = deliverableNodeIds(dependsOn)
    if (injectDeliverable.length) {
      const state = readOrchestrationState(input.plugin.directory, input.missionId)
      if (!state) throw new Error(`orchestration state missing for ${input.missionId}`)
      if (!input.team) throw new Error("dependsOn deliverable requires team spec for validation")
      await assertDependsOnDeliverableReady(
        input.plugin.directory,
        input.missionId,
        input.team,
        state,
        injectDeliverable,
      )
      const dependsOnSummaryBlock = formatDependsOnSummaryBlock(locale, state, injectDeliverable)
      if (dependsOnSummaryBlock.trim()) {
        activationText = [activationText, "", dependsOnSummaryBlock].join("\n")
      }
      const structuredNodeIds = injectDeliverable.filter(
        (nodeId) => state.nodes[nodeId]?.completion?.structured_output !== undefined,
      )
      if (structuredNodeIds.length) {
        const dependsOnStructuredBlock = formatDependsOnStructuredBlock(locale, state, structuredNodeIds)
        if (dependsOnStructuredBlock.trim()) {
          activationText = [activationText, "", dependsOnStructuredBlock].join("\n")
        }
      }
    }
    const brief = await readNodeBriefRegistry(input.plugin.directory, input.missionId, input.nodeId)
    if (!brief) throw runMissingBriefError(input.nodeId)
    if (brief.completion_schema) {
      activationText = [
        activationText,
        "",
        gatehouseMessage("execution.workOrder.structuredCompletionHint", locale, {
          schema: JSON.stringify(brief.completion_schema, null, 2),
        }),
      ].join("\n")
    }
    const architect = input.store.byProfile("architect", "outer")
    const senderLabel = readAgentNamesSync(input.plugin.directory).architect
    const promptText = buildDirectedNotification(senderLabel, activationText, locale)
    return input.store.deliverSystemPrompt(recipient, promptText, {
      promptProfile: profile,
      ...(architect && { senderAgentId: architect.agentId }),
    })
  }

  await promptSession(
    input.plugin.client,
    input.plugin.directory,
    recipient.sessionId,
    { profile, text: input.prompt.text.trim(), noReply: true },
    input.plugin,
  )
  return { status: "sent" as const }
}
