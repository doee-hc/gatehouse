import {
  ARCHITECT_OPENCODE,
  ARBITER_OPENCODE,
  CURATOR_OPENCODE,
  LEAD_OPENCODE,
  OUTER_ARCHITECT_ID,
  OUTER_ARBITER_ID,
  OUTER_CURATOR_ID,
  OUTER_LEAD_ID,
  RETRO_ANALYST_AGENT,
  type RegistryAgent,
} from "./types.ts"
import {
  extractAgentId,
  innerAgentId,
  retroAgentId,
  verifyAgentId,
} from "./types.ts"
import {
  extractSessionTitle,
  nodeDisplayLabel,
  retroSessionTitle,
  verifySessionTitle,
} from "../paths.ts"
import type { MissionExtractManifest, MissionManifest, MissionRetroManifest, MissionVerifyManifest } from "../missions/manifest/types.ts"
import { INNER_EXECUTION_AGENT, INNER_EXTRACT_AGENT, INNER_VERIFY_AGENT } from "./types.ts"
import { now } from "./helpers.ts"
import type { RegistryHost } from "./internals.ts"
import { outerName } from "./session-factory.ts"

export function registerOuterSession(
  host: RegistryHost,
  input: { profile: string; sessionId: string; projectRootSessionId?: string },
) {
  if (input.profile === LEAD_OPENCODE) {
    return host.register({
      agentId: OUTER_LEAD_ID,
      scope: "outer",
      profile: "lead",
      sessionId: input.sessionId,
      displayName: outerName(host, "lead"),
      projectRootSessionId: input.projectRootSessionId ?? input.sessionId,
    })
  }
  if (input.profile === ARCHITECT_OPENCODE) {
    return host.register({
      agentId: OUTER_ARCHITECT_ID,
      scope: "outer",
      profile: "architect",
      sessionId: input.sessionId,
      displayName: outerName(host, "architect"),
      projectRootSessionId: input.projectRootSessionId,
    })
  }
  if (input.profile === CURATOR_OPENCODE) {
    return host.register({
      agentId: OUTER_CURATOR_ID,
      scope: "outer",
      profile: "curator",
      sessionId: input.sessionId,
      displayName: outerName(host, "curator"),
      projectRootSessionId: input.projectRootSessionId,
    })
  }
  if (input.profile === ARBITER_OPENCODE) {
    return host.register({
      agentId: OUTER_ARBITER_ID,
      scope: "outer",
      profile: "arbiter",
      sessionId: input.sessionId,
      displayName: outerName(host, "arbiter"),
      projectRootSessionId: input.projectRootSessionId,
    })
  }
}

export function syncRetroFromManifest(host: RegistryHost, retro: MissionRetroManifest) {
  return host.mutate(() => {
    const projectRootSessionId = host.byProfile("lead", "outer")?.sessionId
    return registerRetroAnalyst(host, {
      missionId: retro.mission_id,
      sessionId: retro.retro_session_id,
      projectRootSessionId,
    })
  })
}

export function registerRetroAnalyst(
  host: RegistryHost,
  input: {
    missionId: string
    sessionId: string
    projectRootSessionId?: string
  },
) {
  return host.mutate(() => {
    const agentId = retroAgentId(input.missionId)
    const existing = host.state.agents.get(agentId)
    const updatedAt = now()
    const record: RegistryAgent = {
      agentId,
      scope: "retro",
      profile: RETRO_ANALYST_AGENT,
      sessionId: input.sessionId,
      displayName: retroSessionTitle(input.missionId),
      missionId: input.missionId,
      status: "active",
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
        projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
      }),
    }
    host.state.agents.set(agentId, record)
    return record
  })
}

export function registerExtractNode(
  host: RegistryHost,
  input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  },
) {
  return host.mutate(() => {
    const agentId = extractAgentId(input.missionId, input.nodeId)
    const existing = host.state.agents.get(agentId)
    const updatedAt = now()
    const record: RegistryAgent = {
      agentId,
      scope: "extract",
      profile: input.profile,
      sessionId: input.sessionId,
      displayName: extractSessionTitle(input.missionId, input.nodeId),
      missionId: input.missionId,
      nodeId: input.nodeId,
      status: "active",
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
        projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
      }),
    }
    host.state.agents.set(agentId, record)
    return record
  })
}

export function registerVerifyNode(
  host: RegistryHost,
  input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  },
) {
  return host.mutate(() => {
    const agentId = verifyAgentId(input.missionId, input.nodeId)
    const existing = host.state.agents.get(agentId)
    const updatedAt = now()
    const record: RegistryAgent = {
      agentId,
      scope: "verify",
      profile: input.profile,
      sessionId: input.sessionId,
      displayName: verifySessionTitle(input.missionId, input.nodeId),
      missionId: input.missionId,
      nodeId: input.nodeId,
      status: "active",
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
        projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
      }),
    }
    host.state.agents.set(agentId, record)
    return record
  })
}

export function syncExtractFromManifest(
  host: RegistryHost,
  extract: MissionExtractManifest,
  manifest: MissionManifest,
) {
  return host.mutate(() => {
    const projectRootSessionId = host.byProfile("lead", "outer")?.sessionId
    const synced: RegistryAgent[] = []
    for (const [nodeId, node] of Object.entries(extract.nodes)) {
      if (!manifest.nodes[nodeId]) continue
      synced.push(
        registerExtractNode(host, {
          missionId: extract.mission_id,
          nodeId,
          sessionId: node.extract_session_id,
          profile: INNER_EXTRACT_AGENT,
          projectRootSessionId,
        }),
      )
    }
    return synced
  })
}

export function syncVerifyFromManifest(host: RegistryHost, verify: MissionVerifyManifest) {
  return host.mutate(() => {
    const projectRootSessionId = host.byProfile("lead", "outer")?.sessionId
    const synced: RegistryAgent[] = []
    for (const [nodeId, node] of Object.entries(verify.nodes)) {
      synced.push(
        registerVerifyNode(host, {
          missionId: verify.mission_id,
          nodeId,
          sessionId: node.verify_session_id,
          profile: INNER_VERIFY_AGENT,
          projectRootSessionId,
        }),
      )
    }
    return synced
  })
}

export function registerInnerNode(
  host: RegistryHost,
  input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  },
) {
  return host.mutate(() => {
    const agentId = innerAgentId(input.missionId, input.nodeId)
    const existing = host.state.agents.get(agentId)
    const updatedAt = now()
    const record: RegistryAgent = {
      agentId,
      scope: "inner",
      profile: input.profile,
      sessionId: input.sessionId,
      displayName: nodeDisplayLabel(input.nodeId),
      missionId: input.missionId,
      nodeId: input.nodeId,
      status: "active",
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
        projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
      }),
    }
    host.state.agents.set(agentId, record)
    return record
  })
}

export function syncInnerFromManifest(host: RegistryHost, manifest: MissionManifest) {
  return host.mutate(() => {
    const projectRootSessionId = host.byProfile("lead", "outer")?.sessionId
    const agents: RegistryAgent[] = []
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      agents.push(
        registerInnerNode(host, {
          missionId: manifest.mission_id,
          nodeId,
          sessionId: node.session_id,
          profile: node.profile ?? INNER_EXECUTION_AGENT,
          projectRootSessionId,
        }),
      )
    }
    return agents
  })
}

export function deactivateRetroAgent(host: RegistryHost, missionId: string) {
  return host.mutate(() => {
    const agentId = retroAgentId(missionId)
    const agent = host.state.agents.get(agentId)
    if (!agent || agent.status !== "active") return 0
    host.state.agents.set(agentId, { ...agent, status: "completed", updatedAt: now() })
    return 1
  })
}

export function deactivateExtractAgentForNode(host: RegistryHost, missionId: string, nodeId: string) {
  return host.mutate(() => {
    const agentId = extractAgentId(missionId, nodeId)
    const agent = host.state.agents.get(agentId)
    if (!agent || agent.status !== "active") return 0
    host.state.agents.set(agentId, { ...agent, status: "completed", updatedAt: now() })
    return 1
  })
}

export function deactivateVerifyAgentForNode(host: RegistryHost, missionId: string, nodeId: string) {
  return host.mutate(() => {
    const agentId = verifyAgentId(missionId, nodeId)
    const agent = host.state.agents.get(agentId)
    if (!agent || agent.status !== "active") return 0
    host.state.agents.set(agentId, { ...agent, status: "completed", updatedAt: now() })
    return 1
  })
}

export function deactivateVerifyAgentsForMission(host: RegistryHost, missionId: string) {
  return host.mutate(() => {
    const updatedAt = now()
    for (const [agentId, agent] of host.state.agents.entries()) {
      if (agent.scope !== "verify" || agent.missionId !== missionId || agent.status !== "active") continue
      host.state.agents.set(agentId, { ...agent, status: "completed", updatedAt })
    }
  })
}
