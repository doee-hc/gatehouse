import type { RegistryStore } from "./store.ts"
import { GATEHOUSE_OUTER_AGENTS, LEAD_OPENCODE, type RegistryAgent } from "./types.ts"
import { agentName, normalizeOuterProfile, readAgentNamesSync } from "../names.ts"

export function outerAgentDisplay(projectDirectory: string, profileSlug: string) {
  const profile = normalizeOuterProfile(profileSlug)
  if (!profile) return profileSlug
  return agentName(readAgentNamesSync(projectDirectory), profile)
}

function duplicateLeadMessage(registeredLead: RegistryAgent) {
  return `A lead session already exists (${registeredLead.displayName}, profile: lead); open that session instead of creating another lead.`
}

export function duplicateLeadBlockReason(
  registeredLead: RegistryAgent | undefined,
  sessionId: string,
  requestedProfile: string,
) {
  const requested = normalizeOuterProfile(requestedProfile)
  if (requested !== LEAD_OPENCODE) return
  if (!registeredLead || registeredLead.sessionId === sessionId) return
  return duplicateLeadMessage(registeredLead)
}

export function duplicateLeadCreateBlockReason(
  registeredLead: RegistryAgent | undefined,
  requestedAgent?: string,
) {
  const requested = requestedAgent ? normalizeOuterProfile(requestedAgent) : undefined
  if (requested !== LEAD_OPENCODE) return
  if (!registeredLead) return
  return duplicateLeadMessage(registeredLead)
}

export function outerChatMessageBlockReason(
  projectDirectory: string,
  owner: RegistryAgent | undefined,
  sessionId: string,
  agent: string,
  registeredLead?: RegistryAgent,
) {
  if (owner?.scope === "outer") {
    const requested = normalizeOuterProfile(agent)
    if (!requested) return
    if (owner.profile === requested) return
    return `This session is registered as ${owner.displayName} (profile: ${owner.profile}); cannot send as ${outerAgentDisplay(projectDirectory, requested)} (profile: ${requested}). Open that role's dedicated session instead.`
  }
  return duplicateLeadBlockReason(registeredLead, sessionId, agent)
}

export function assertOuterChatMessageAllowed(
  projectDirectory: string,
  owner: RegistryAgent | undefined,
  sessionId: string,
  agent: string,
  registeredLead?: RegistryAgent,
) {
  const reason = outerChatMessageBlockReason(projectDirectory, owner, sessionId, agent, registeredLead)
  if (reason) throw new Error(reason)
}

export async function handleOuterChatMessage(
  registry: RegistryStore,
  input: { sessionID: string; agent?: string },
) {
  const rawAgent = input.agent?.trim()
  const agent = rawAgent ? normalizeOuterProfile(rawAgent) : undefined
  if (!agent || !GATEHOUSE_OUTER_AGENTS.has(agent)) return

  const registeredLead = registry.byProfile("lead", "outer")
  assertOuterChatMessageAllowed(
    registry.directory,
    registry.bySession(input.sessionID),
    input.sessionID,
    agent,
    registeredLead,
  )

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
