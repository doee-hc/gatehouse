import type { PluginInput } from "@opencode-ai/plugin"
import { readNodeBriefRegistry } from "../execution/artifacts.ts"
import { buildDirectedNotification, gatehouseMessage } from "../i18n.ts"
import { gatehouseLog } from "../log.ts"
import { readLocaleSync } from "../locale.ts"
import { readAgentNamesSync } from "../names.ts"
import { innerAgentId } from "../registry/types.ts"
import type { RegistryStore } from "../registry/store.ts"
import { promptSession } from "../session/client.ts"
import { assertRollupFromReady, formatRollupInjectionBlock } from "./completion.ts"
import { readOrchestrationState } from "./state.ts"
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
    const rollupFrom = input.prompt.rollupFrom?.filter((id) => id.trim())
    if (rollupFrom?.length) {
      const state = readOrchestrationState(input.plugin.directory, input.missionId)
      if (!state) throw new Error(`orchestration state missing for ${input.missionId}`)
      if (!input.team) throw new Error("rollupFrom requires team spec for validation")
      assertRollupFromReady(input.team, state, rollupFrom)
      const rollupBlock = formatRollupInjectionBlock(locale, state, rollupFrom)
      if (rollupBlock.trim()) {
        activationText = [activationText, "", rollupBlock].join("\n")
      }
    }
    const brief = await readNodeBriefRegistry(input.plugin.directory, input.missionId, input.nodeId)
    if (!brief) {
      gatehouseLog(
        "warn",
        `[orchestration:${input.missionId}] activating ${input.nodeId} without node brief (ctx.setBrief not called)`,
      )
      const leadName = readAgentNamesSync(input.plugin.directory).lead
      activationText = [
        activationText,
        "",
        gatehouseMessage("execution.workOrder.missingBriefWarning", locale, {
          node_id: input.nodeId,
          lead_name: leadName,
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
