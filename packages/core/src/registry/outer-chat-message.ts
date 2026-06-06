import type { RegistryStore } from "./store.ts"
import { GATEHOUSE_OUTER_AGENTS, LEAD_OPENCODE, type RegistryAgent } from "./types.ts"
import { agentName, normalizeOuterProfile, readAgentNamesSync } from "../names.ts"

export function outerAgentDisplay(projectDirectory: string, profileSlug: string) {
  const profile = normalizeOuterProfile(profileSlug)
  if (!profile) return profileSlug
  return agentName(readAgentNamesSync(projectDirectory), profile)
}

export function outerChatMessageBlockReason(
  projectDirectory: string,
  owner: RegistryAgent | undefined,
  agent: string,
) {
  if (!owner || owner.scope !== "outer") return
  const requested = normalizeOuterProfile(agent)
  if (!requested) return
  if (owner.profile === requested) return
  return `This session is registered as ${owner.displayName} (profile: ${owner.profile}); cannot send as ${outerAgentDisplay(projectDirectory, requested)} (profile: ${requested}). Open that role's dedicated session instead.`
}

export function assertOuterChatMessageAllowed(
  projectDirectory: string,
  owner: RegistryAgent | undefined,
  agent: string,
) {
  const reason = outerChatMessageBlockReason(projectDirectory, owner, agent)
  if (reason) throw new Error(reason)
}

export async function handleOuterChatMessage(
  registry: RegistryStore,
  input: { sessionID: string; agent?: string },
) {
  const rawAgent = input.agent?.trim()
  const agent = rawAgent ? normalizeOuterProfile(rawAgent) : undefined
  if (!agent || !GATEHOUSE_OUTER_AGENTS.has(agent)) return

  assertOuterChatMessageAllowed(registry.directory, registry.bySession(input.sessionID), agent)

  const existing = registry.bySession(input.sessionID)
  registry.registerOuterSession({
    profile: agent,
    sessionId: input.sessionID,
    projectRootSessionId:
      agent === LEAD_OPENCODE ? input.sessionID : registry.byProfile("lead", "outer")?.sessionId,
  })
  registry.syncOuterDisplayNames()
  await registry.syncOuterSessionTitle(input.sessionID, agent)

  if (agent === LEAD_OPENCODE && !existing) {
    await registry.ensureLeadSystemPrompt(input.sessionID)
  }
}
