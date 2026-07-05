import { OUTER_PROFILES, type OuterProfile } from "../names.ts"
import type { RegistryStore } from "../registry/store.ts"
import type { RegistryAgent } from "../registry/types.ts"
import {
  ARBITER_OPENCODE,
  GATEHOUSE_OUTER_AGENTS,
  LEAD_OPENCODE,
} from "../registry/types.ts"
import { activeMissionId } from "../missions/scope.ts"
import { manifestMembers } from "../missions/manifest/team-spec.ts"
import { findMissionBySession, readMissionManifest, readRetroManifest } from "../missions/manifest/store.ts"
import type { MissionRetroManifest, MissionManifest, MissionMember } from "../missions/manifest/types.ts"

const CORE_OUTER_ROLES = ["architect", "curator", "arbiter"] as const satisfies readonly OuterProfile[]

export type ListTeamYou = {
  profile: string
  node_id?: string
}

export type ListTeamOuterMember = {
  profile: string
  display_name: string
  ready?: boolean
  session_id?: string
}

export type ListTeamExecutionMember = {
  node_id: string
  description?: string
  display_name?: string
  profile?: string
  has_retro?: boolean
  session_id?: string
}

export type ListTeamRetroMember = {
  node_id: string
  display_name?: string
  profile?: string
  session_id?: string
}

export type ListTeamPayload = {
  you: ListTeamYou
  mission_id: string | null
  outer?: ListTeamOuterMember[]
  execution?: ListTeamExecutionMember[]
  retro?: ListTeamRetroMember[]
}

export type ListTeamResult = ListTeamPayload | { error: string; code: string }

type MissionSessionHit = {
  missionId: string
  manifest: MissionManifest
  retro?: MissionRetroManifest
}

export async function buildListTeamData(input: {
  store: RegistryStore
  directory: string
  callerProfile: string
  sessionId: string
}): Promise<ListTeamResult> {
  const registryAgent = input.store.bySession(input.sessionId)
  const missionHit = await resolveMissionSession(input.store, input.directory, input.sessionId)
  if (missionHit?.retro && retroNodeIdForSession(missionHit.retro, input.sessionId)) {
    return buildRetroListTeam(input, missionHit.manifest, missionHit.retro)
  }
  if (registryAgent?.scope === "retro" && registryAgent.missionId) {
    const manifest = await readMissionManifest(input.directory, registryAgent.missionId)
    const retro = await readRetroManifest(input.directory, registryAgent.missionId)
    if (manifest && retro) return buildRetroListTeam(input, manifest, retro)
  }
  if (registryAgent?.scope === "inner") return buildInnerListTeam(input, registryAgent, missionHit?.manifest)
  if (missionHit?.manifest) return buildInnerListTeam(input, registryAgent, missionHit.manifest)
  if (GATEHOUSE_OUTER_AGENTS.has(input.callerProfile) || registryAgent?.scope === "outer") {
    return buildOuterListTeam(input)
  }
  return buildOuterListTeam(input)
}

async function buildOuterListTeam(input: {
  store: RegistryStore
  directory: string
  callerProfile: string
  sessionId: string
}) {
  const includeSessionId = input.callerProfile === ARBITER_OPENCODE
  const missionId = activeMissionId(input.store)
  const manifest = missionId ? await readMissionManifest(input.directory, missionId) : undefined
  const retro = missionId ? await readRetroManifest(input.directory, missionId) : undefined
  return {
    you: { profile: input.callerProfile },
    mission_id: missionId ?? null,
    outer: outerMembers(input.store, input.callerProfile, includeSessionId),
    ...(manifest && {
      execution: executionMembers(manifest, undefined, includeSessionId, input.store, missionId!),
    }),
    ...(retro && {
      retro: retroMembers(retro, includeSessionId, input.store),
    }),
  } satisfies ListTeamPayload
}

function retroMembers(retro: MissionRetroManifest, includeSessionId: boolean, store: RegistryStore) {
  const agent = store.bySession(retro.retro_session_id)
  const entry: ListTeamRetroMember = { node_id: "retro-analyst" }
  if (agent?.displayName) entry.display_name = agent.displayName
  if (agent?.profile) entry.profile = agent.profile
  if (includeSessionId) entry.session_id = retro.retro_session_id
  return [entry]
}

async function buildInnerListTeam(
  input: {
    store: RegistryStore
    directory: string
    callerProfile: string
    sessionId: string
  },
  registryAgent: RegistryAgent | undefined,
  manifestFromSession?: MissionManifest,
) {
  const missionId = registryAgent?.missionId ?? manifestFromSession?.mission_id ?? activeMissionId(input.store)
  if (!missionId) return listTeamError("NO_ACTIVE_MISSION", "No active mission; call gatehouse_mission_start first")
  const manifest = manifestFromSession ?? (await readMissionManifest(input.directory, missionId))
  if (!manifest) return listTeamError("MANIFEST_NOT_FOUND", "Could not resolve mission manifest for this session")
  const retro = await readRetroManifest(input.directory, missionId)
  const youNodeId = resolveYouNodeId(manifest, input.sessionId, registryAgent?.nodeId)
  const payload: ListTeamPayload = {
    you: { profile: input.callerProfile, ...(youNodeId && { node_id: youNodeId }) },
    mission_id: missionId,
    execution: executionMembers(manifest, undefined, false, input.store, missionId),
  }
  const terminalNode =
    youNodeId !== undefined && youNodeId === manifest.terminal_node
  if (terminalNode) {
    const lead = input.store.byProfile(LEAD_OPENCODE, "outer")
    if (lead) payload.outer = [{ profile: LEAD_OPENCODE, display_name: lead.displayName }]
  }
  return payload
}

async function buildRetroListTeam(
  input: {
    store: RegistryStore
    directory: string
    callerProfile: string
    sessionId: string
  },
  manifest: MissionManifest,
  retro: MissionRetroManifest,
) {
  if (retro.retro_session_id !== input.sessionId) {
    return listTeamError("RETRO_NODE_UNKNOWN", "Could not resolve retro session for this session")
  }
  return {
    you: { profile: input.callerProfile, node_id: "retro-analyst" },
    mission_id: manifest.mission_id,
    execution: executionMembers(manifest, undefined, false, input.store, manifest.mission_id),
  } satisfies ListTeamPayload
}

function listTeamError(code: string, message: string) {
  return { error: message, code } as const
}

function outerMembers(store: RegistryStore, callerProfile: string, includeSessionId: boolean) {
  if (callerProfile === LEAD_OPENCODE) {
    return CORE_OUTER_ROLES.map((profile) => {
      const agent = store.byProfile(profile, "outer")
      const member: ListTeamOuterMember = agent
        ? { profile, display_name: agent.displayName, ready: true }
        : { profile, display_name: profile, ready: false }
      if (includeSessionId && agent) member.session_id = agent.sessionId
      return member
    })
  }
  return OUTER_PROFILES.flatMap((profile) => {
    const agent = store.byProfile(profile, "outer")
    if (!agent) return []
    const member: ListTeamOuterMember = { profile, display_name: agent.displayName }
    if (includeSessionId) member.session_id = agent.sessionId
    return [member]
  })
}

function executionMembers(
  manifest: MissionManifest,
  retroNodeIds: Set<string> | undefined,
  includeSessionId: boolean,
  store: RegistryStore,
  missionId: string,
  onlyNodeIds?: Set<string>,
) {
  const members = manifestMembers(manifest)
  const filtered = onlyNodeIds ? members.filter((item) => onlyNodeIds.has(item.node_id)) : members
  return filtered.map((member) => toExecutionMember(member, retroNodeIds, includeSessionId, store, missionId))
}

function toExecutionMember(
  member: MissionMember,
  retroNodeIds: Set<string> | undefined,
  includeSessionId: boolean,
  store: RegistryStore,
  missionId: string,
) {
  const entry: ListTeamExecutionMember = {
    node_id: member.node_id,
    ...(member.description && { description: member.description }),
    ...(member.display_name && { display_name: member.display_name }),
    ...(member.profile && { profile: member.profile }),
  }
  if (retroNodeIds?.has(member.node_id)) entry.has_retro = true
  if (includeSessionId) {
    const agent = store.byAgentId(`inner:${missionId}:${member.node_id}`)
    if (agent) entry.session_id = agent.sessionId
  }
  return entry
}

function resolveYouNodeId(manifest: MissionManifest, sessionId: string, nodeId?: string) {
  if (nodeId) return nodeId
  const fromManifest = Object.entries(manifest.nodes).find(([, node]) => node.session_id === sessionId)?.[0]
  return fromManifest
}

function retroNodeIdForSession(retro: MissionRetroManifest, sessionId: string) {
  return retro.retro_session_id === sessionId ? "retro-analyst" : undefined
}

async function resolveMissionSession(
  store: RegistryStore,
  directory: string,
  sessionId: string,
): Promise<MissionSessionHit | undefined> {
  const hit = await findMissionBySession(directory, sessionId)
  if (hit) return hit
  const missionId = activeMissionId(store)
  if (!missionId) return undefined
  const manifest = await readMissionManifest(directory, missionId)
  if (!manifest) return undefined
  const inManifest = Object.values(manifest.nodes).some((node) => node.session_id === sessionId)
  if (!inManifest) return undefined
  const retro = await readRetroManifest(directory, missionId)
  return { missionId, manifest, ...(retro && { retro }) }
}
