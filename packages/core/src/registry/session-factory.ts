import {
  ARCHITECT_OPENCODE,
  ARBITER_OPENCODE,
  CURATOR_OPENCODE,
  OUTER_ARCHITECT_ID,
  OUTER_ARBITER_ID,
  OUTER_CURATOR_ID,
} from "./types.ts"
import { loadGatehouseConfig, modelForOuterProfile } from "../gatehouse-config.ts"
import { readAgentNamesSync, agentName, OUTER_PROFILES, type OuterProfile } from "../names.ts"
import { loadArchitectPrompt } from "../prompt/architect.ts"
import { loadArbiterPrompt } from "../prompt/arbiter.ts"
import { loadCuratorPrompt } from "../prompt/curator.ts"
import {
  createSession,
  promptSession,
  sessionExists,
  updateSessionTitle,
} from "../session/client.ts"
import type { RegistryHost } from "./internals.ts"

export function outerName(host: RegistryHost, profile: OuterProfile) {
  return agentName(readAgentNamesSync(host.directory), profile)
}

export function outerModel(host: RegistryHost, profile: OuterProfile) {
  return modelForOuterProfile(loadGatehouseConfig(host.directory).models, profile)
}

export async function syncOuterSessionTitle(host: RegistryHost, sessionId: string, profile: OuterProfile) {
  await updateSessionTitle(
    host.options.client,
    host.directory,
    sessionId,
    outerName(host, profile),
  )
}

export function syncOuterDisplayNames(host: RegistryHost) {
  for (const profile of OUTER_PROFILES) {
    const agent = host.byProfile(profile, "outer")
    if (!agent) continue
    const displayName = outerName(host, profile)
    if (agent.displayName === displayName) continue
    host.register({
      agentId: agent.agentId,
      scope: agent.scope,
      profile: agent.profile,
      sessionId: agent.sessionId,
      displayName,
      status: agent.status,
      ...(agent.missionId && { missionId: agent.missionId }),
      ...(agent.nodeId && { nodeId: agent.nodeId }),
      ...(agent.projectRootSessionId && { projectRootSessionId: agent.projectRootSessionId }),
    })
  }
}

export async function ensureArchitectSession(host: RegistryHost, projectRootSessionId?: string) {
  const existing = host.byProfile("architect", "outer")
  if (existing?.sessionId) {
    if (await sessionExists(host.options.client, host.directory, existing.sessionId)) {
      syncOuterDisplayNames(host)
      return { agent: host.byProfile("architect", "outer") ?? existing, createdSession: false }
    }
    host.removeAgent(OUTER_ARCHITECT_ID)
  }
  const sessionId = await createSession(host.options.client, host.directory, {
    display_name: outerName(host, "architect"),
    profile: ARCHITECT_OPENCODE,
    model: outerModel(host, "architect"),
  })
  await promptSession(host.options.client, host.directory, sessionId, {
    profile: ARCHITECT_OPENCODE,
    system: await loadArchitectPrompt(host.directory),
    noReply: true,
    model: outerModel(host, "architect"),
  }, host.options.plugin)
  const agent = host.register({
    agentId: OUTER_ARCHITECT_ID,
    scope: "outer",
    profile: "architect",
    sessionId,
    displayName: outerName(host, "architect"),
    projectRootSessionId,
  })
  return { agent, createdSession: true }
}

export async function ensureCuratorSession(host: RegistryHost, projectRootSessionId?: string) {
  const existing = host.byProfile("curator", "outer")
  if (existing?.sessionId) {
    if (await sessionExists(host.options.client, host.directory, existing.sessionId)) {
      syncOuterDisplayNames(host)
      return { agent: host.byProfile("curator", "outer") ?? existing, createdSession: false }
    }
    host.removeAgent(OUTER_CURATOR_ID)
  }
  const sessionId = await createSession(host.options.client, host.directory, {
    display_name: outerName(host, "curator"),
    profile: CURATOR_OPENCODE,
    model: outerModel(host, "curator"),
  })
  await promptSession(host.options.client, host.directory, sessionId, {
    profile: CURATOR_OPENCODE,
    system: await loadCuratorPrompt(host.directory),
    noReply: true,
    model: outerModel(host, "curator"),
  }, host.options.plugin)
  const agent = host.register({
    agentId: OUTER_CURATOR_ID,
    scope: "outer",
    profile: "curator",
    sessionId,
    displayName: outerName(host, "curator"),
    projectRootSessionId,
  })
  return { agent, createdSession: true }
}

export async function ensureArbiterSession(host: RegistryHost, projectRootSessionId?: string) {
  const existing = host.byProfile("arbiter", "outer")
  if (existing?.sessionId) {
    if (await sessionExists(host.options.client, host.directory, existing.sessionId)) {
      syncOuterDisplayNames(host)
      return { agent: host.byProfile("arbiter", "outer") ?? existing, createdSession: false }
    }
    host.removeAgent(OUTER_ARBITER_ID)
  }
  const sessionId = await createSession(host.options.client, host.directory, {
    display_name: outerName(host, "arbiter"),
    profile: ARBITER_OPENCODE,
    model: outerModel(host, "arbiter"),
  })
  await promptSession(host.options.client, host.directory, sessionId, {
    profile: ARBITER_OPENCODE,
    system: await loadArbiterPrompt(host.directory),
    noReply: true,
    model: outerModel(host, "arbiter"),
  }, host.options.plugin)
  const agent = host.register({
    agentId: OUTER_ARBITER_ID,
    scope: "outer",
    profile: "arbiter",
    sessionId,
    displayName: outerName(host, "arbiter"),
    projectRootSessionId,
  })
  return { agent, createdSession: true }
}

export async function initOuterTeam(host: RegistryHost, projectRootSessionId: string) {
  syncOuterDisplayNames(host)
  const architect = await ensureArchitectSession(host, projectRootSessionId)
  const curator = await ensureCuratorSession(host, projectRootSessionId)
  const arbiter = await ensureArbiterSession(host, projectRootSessionId)
  syncOuterDisplayNames(host)
  const names = readAgentNamesSync(host.directory)
  return {
    names,
    architect: {
      profile: "architect",
      display_name: names.architect,
      session_id: architect.agent.sessionId,
      created_session: architect.createdSession,
    },
    curator: {
      profile: "curator",
      display_name: names.curator,
      session_id: curator.agent.sessionId,
      created_session: curator.createdSession,
    },
    arbiter: {
      profile: "arbiter",
      display_name: names.arbiter,
      session_id: arbiter.agent.sessionId,
      created_session: arbiter.createdSession,
    },
  }
}
