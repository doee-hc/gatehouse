import type { ChannelBridgeConfig } from "../types.ts"
import type { OpencodeClient } from "../opencode/client.ts"
import {
  latestDeliverableAssistantMessageId,
  listSessionMessages,
} from "../opencode/assistant-messages.ts"
import {
  formatAgentDirectoryForProject,
  listSwitchableAgents,
  resolveAgentTarget,
} from "./agent-target.ts"
import { readCurrentMissionId } from "../missions.ts"
import { getActiveAgentId, setActiveAgentId, setLastDeliveredAssistantMessageId } from "../store/state.ts"

export type AgentCommand = { kind: "list" } | { kind: "switch"; agentId: string }

export type AgentCommandResult = {
  text: string
  /** Set when the user switched agents; used by relay bridges for proactive delivery. */
  switchedSessionId?: string
}

export function parseAgentCommand(text: string): AgentCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/agent")) return undefined
  const rest = trimmed.slice("/agent".length).trim()
  if (!rest) return { kind: "list" }
  const agentId = rest.split(/\s+/)[0]?.trim()
  if (!agentId) return { kind: "list" }
  return { kind: "switch", agentId }
}

async function buildAgentListReply(config: ChannelBridgeConfig, userId: string) {
  const currentMissionId = await readCurrentMissionId(config.projectDir)
  const switchable = await listSwitchableAgents(config.projectDir)
  return formatAgentDirectoryForProject(config.projectDir, switchable, {
    currentAgentId: getActiveAgentId(config.stateDir, userId),
    currentMissionId,
  })
}

/** Mark existing assistant messages as already delivered so only subsequent replies are relayed. */
export async function syncAgentDeliveryWatermark(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  userId: string,
  sessionId: string,
) {
  const rows = await listSessionMessages(client, config, sessionId)
  const latestId = latestDeliverableAssistantMessageId(rows)
  if (latestId) {
    setLastDeliveredAssistantMessageId(config.stateDir, userId, sessionId, latestId)
  }
}

export async function handleAgentCommand(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  userId: string,
  command: AgentCommand,
): Promise<AgentCommandResult> {
  if (command.kind === "list") {
    return { text: await buildAgentListReply(config, userId) }
  }

  const requestedId = command.agentId
  const agent = await resolveAgentTarget(client, config, requestedId)
  setActiveAgentId(config.stateDir, userId, agent.agentId)
  await syncAgentDeliveryWatermark(client, config, userId, agent.sessionId)
  return {
    text: `Switched to ${agent.agentId} (${agent.displayName})`,
    switchedSessionId: agent.sessionId,
  }
}

export async function resolveActiveAgentTarget(client: OpencodeClient, config: ChannelBridgeConfig, userId: string) {
  return resolveAgentTarget(client, config, getActiveAgentId(config.stateDir, userId))
}
