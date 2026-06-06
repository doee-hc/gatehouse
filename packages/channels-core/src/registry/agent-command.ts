import type { ChannelBridgeConfig } from "../types.ts"
import type { OpencodeClient } from "../opencode/client.ts"
import {
  formatAgentDirectoryForProject,
  listSwitchableAgents,
  resolveAgentTarget,
} from "./agent-target.ts"
import { readCurrentMissionId } from "../missions.ts"
import { getActiveAgentId, setActiveAgentId } from "../store/state.ts"

export type AgentCommand = { kind: "list" } | { kind: "switch"; agentId: string }

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

export async function handleAgentCommand(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  userId: string,
  command: AgentCommand,
) {
  if (command.kind === "list") {
    return buildAgentListReply(config, userId)
  }

  const requestedId = command.agentId
  const agent = await resolveAgentTarget(client, config, requestedId)
  setActiveAgentId(config.stateDir, userId, agent.agentId)
  return `已切换到 ${agent.agentId}（${agent.displayName}）`
}

export async function resolveActiveAgentTarget(client: OpencodeClient, config: ChannelBridgeConfig, userId: string) {
  return resolveAgentTarget(client, config, getActiveAgentId(config.stateDir, userId))
}
