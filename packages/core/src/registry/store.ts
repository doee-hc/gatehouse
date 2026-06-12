import type { PluginInput } from "@opencode-ai/plugin"
import { RegistryDatabase } from "./db.ts"
import { enrichLeadDeliveryMessage } from "../messaging/delivery-notify.ts"
import { architectRetroBatchReadyMessage, loadRetroKickoffPrompt } from "../retro/prompt.ts"
import { loadDomainSkillExtractPrompt, execSkillKickoffTargets } from "../retro/skill-kickoff.ts"
import { loadCuratorSkillAssignKickoff, curatorSkillExtractBatchReadyMessage } from "../curator/prompt.ts"
import { loadLeadPrompt } from "../prompt/lead.ts"
import type { TeamSpec } from "../tree/types.ts"
import { loadArchitectPrompt } from "../prompt/architect.ts"
import { loadArbiterPrompt } from "../prompt/arbiter.ts"
import { loadCuratorPrompt } from "../prompt/curator.ts"
import { curatorSkillSummaryRelPath, nodeDisplayLabel, retroNodeReportRelPath, sessionTitle } from "../paths.ts"
import { buildDirectedNotification, gatehouseMessage, parseDirectedNotification } from "../i18n.ts"
import { loadGatehouseConfig, modelForOuterProfile } from "../gatehouse-config.ts"
import { readLocaleSync } from "../locale.ts"
import { agentName, normalizeOuterProfile, OUTER_PROFILES, readAgentNamesSync, type OuterProfile } from "../names.ts"
import {
  ARCHITECT_OPENCODE,
  LEAD_OPENCODE,
  INNER_EXECUTION_AGENT,
  innerProfileMayNotifyLead,
  ARBITER_OPENCODE,
  CURATOR_OPENCODE,
  OUTER_ARCHITECT_ID,
  OUTER_LEAD_ID,
  OUTER_ARBITER_ID,
  OUTER_CURATOR_ID,
  REGISTRY_SCHEMA_VERSION,
  type SendMessageInput,
  type SendMessageResult,
  retroAgentId,
  type RegisterAgentInput,
  type RegistryAgent,
  type RegistryPendingDelivery,
  type RegistryRetroCompletion,
  type RegistryRetroRun,
  type RegistrySkillExtractCompletion,
  type RegistrySkillExtractRun,
  type RegistryScope,
  innerAgentId,
  isInnerStructuralRoot,
} from "./types.ts"
import type { RetroManifest, TreeManifest } from "../tree/types.ts"
import {
  createSession,
  promptSession,
  sessionExists,
  updateSessionTitle,
  type GatehouseClient,
} from "../session/client.ts"
import { sessionStatusById } from "../session/status.ts"
import { emitPortalEvent } from "../portal/events.ts"
import { spawnIdForAgent } from "../portal/spawn-id.ts"
import { notifyWatchdogSendMessage } from "../watchdog/notify.ts"
import { bindWatchdogStateStore } from "../watchdog/state-store.ts"

const MAX_DELIVERY_ATTEMPTS = 10

type StoreOptions = {
  directory: string
  client: GatehouseClient
  plugin?: PluginInput
}

type ResolveOptions = {
  missionId?: string
  scope?: RegistryScope
  sender?: RegistryAgent
}

type RecipientResolution =
  | { status: "resolved"; recipient: RegistryAgent; matchedBy: "agentId" | "sessionId" | "profile" | "displayName" | "nodeId" }
  | { status: "not_found"; query: string; candidates: RegistryAgent[] }
  | { status: "ambiguous"; query: string; candidates: RegistryAgent[] }

function now() {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function pendingEligible(delivery: RegistryPendingDelivery, nowIso: string) {
  if (delivery.nextRetryAt && delivery.nextRetryAt > nowIso) return false
  return true
}

function deliveryBackoffMs(attempts: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}

function formatDirectedNotification(
  projectDirectory: string,
  senderLabel: string,
  content: string,
) {
  return buildDirectedNotification(senderLabel, content, readLocaleSync(projectDirectory))
}

function retroCompletionKey(missionId: string, nodeId: string) {
  return `${missionId}:${nodeId}`
}

function skillExtractCompletionKey(missionId: string, nodeId: string) {
  return `${missionId}:${nodeId}`
}

export class RegistryStore {
  readonly dbPath: string
  private agents = new Map<string, RegistryAgent>()
  private pendingDeliveries: RegistryPendingDelivery[] = []
  private retroRuns = new Map<string, RegistryRetroRun>()
  private retroCompletions = new Map<string, RegistryRetroCompletion>()
  private skillExtractRuns = new Map<string, RegistrySkillExtractRun>()
  private skillExtractCompletions = new Map<string, RegistrySkillExtractCompletion>()
  private db: RegistryDatabase
  private flushTail: Promise<void> = Promise.resolve()

  private constructor(private options: StoreOptions) {
    this.db = new RegistryDatabase(options.directory)
    this.dbPath = this.db.path
  }

  get directory() {
    return this.options.directory
  }

  private outerName(profile: OuterProfile) {
    return agentName(readAgentNamesSync(this.options.directory), profile)
  }

  private outerModel(profile: OuterProfile) {
    return modelForOuterProfile(loadGatehouseConfig(this.options.directory).models, profile)
  }

  async syncOuterSessionTitle(sessionId: string, profile: OuterProfile) {
    await updateSessionTitle(
      this.options.client,
      this.options.directory,
      sessionId,
      this.outerName(profile),
    )
  }

  syncOuterDisplayNames() {
    for (const profile of OUTER_PROFILES) {
      const agent = this.byProfile(profile, "outer")
      if (!agent) continue
      const displayName = this.outerName(profile)
      if (agent.displayName === displayName) continue
      this.register({
        agentId: agent.agentId,
        scope: agent.scope,
        profile: agent.profile,
        sessionId: agent.sessionId,
        displayName,
        status: agent.status,
        ...(agent.missionId && { missionId: agent.missionId }),
        ...(agent.nodeId && { nodeId: agent.nodeId }),
        ...(agent.parentSessionId && { parentSessionId: agent.parentSessionId }),
        ...(agent.projectRootSessionId && { projectRootSessionId: agent.projectRootSessionId }),
      })
    }
  }

  async ensureLeadSystemPrompt(sessionId: string) {
    await promptSession(this.options.client, this.options.directory, sessionId, {
      profile: LEAD_OPENCODE,
      system: await loadLeadPrompt(this.options.directory),
      noReply: true,
      model: this.outerModel("lead"),
    }, this.options.plugin)
  }

  static async create(options: StoreOptions) {
    const store = new RegistryStore(options)
    store.loadSnapshot()
    bindWatchdogStateStore(options.directory, store.db)
    return store
  }

  private loadSnapshot() {
    const snapshot = this.db.load()
    this.agents = new Map(snapshot.agents.map((item) => [item.agentId, item]))
    this.pendingDeliveries = snapshot.pendingDeliveries
    this.retroRuns = new Map(snapshot.retroRuns.map((item) => [item.missionId, item]))
    this.retroCompletions = new Map(
      snapshot.retroCompletions.map((item) => [retroCompletionKey(item.missionId, item.nodeId), item]),
    )
    this.skillExtractRuns = new Map(snapshot.skillExtractRuns.map((item) => [item.missionId, item]))
    this.skillExtractCompletions = new Map(
      snapshot.skillExtractCompletions.map((item) => [skillExtractCompletionKey(item.missionId, item.nodeId), item]),
    )
  }

  private memorySnapshot() {
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now(),
      agents: Array.from(this.agents.values()),
      pendingDeliveries: [...this.pendingDeliveries],
      retroRuns: Array.from(this.retroRuns.values()),
      retroCompletions: Array.from(this.retroCompletions.values()),
      skillExtractRuns: Array.from(this.skillExtractRuns.values()),
      skillExtractCompletions: Array.from(this.skillExtractCompletions.values()),
    }
  }

  private mutate<T>(fn: () => T) {
    const result = fn()
    this.db.save(this.memorySnapshot())
    return result
  }

  private removeAgent(agentId: string) {
    this.mutate(() => {
      this.agents.delete(agentId)
    })
  }

  register(input: RegisterAgentInput) {
    return this.mutate(() => {
      const updatedAt = now()
      const record: RegistryAgent = {
        agentId: input.agentId,
        scope: input.scope,
        profile: input.profile,
        sessionId: input.sessionId,
        displayName: input.displayName,
        status: input.status ?? "active",
        createdAt: this.agents.get(input.agentId)?.createdAt ?? updatedAt,
        updatedAt,
        ...(input.missionId && { missionId: input.missionId }),
        ...(input.nodeId && { nodeId: input.nodeId }),
        ...(input.parentSessionId && { parentSessionId: input.parentSessionId }),
        ...(input.projectRootSessionId && { projectRootSessionId: input.projectRootSessionId }),
      }
      this.agents.set(input.agentId, record)
      return record
    })
  }

  registerOuterSession(input: { profile: string; sessionId: string; projectRootSessionId?: string }) {
    if (input.profile === LEAD_OPENCODE) {
      return this.register({
        agentId: OUTER_LEAD_ID,
        scope: "outer",
        profile: "lead",
        sessionId: input.sessionId,
        displayName: this.outerName("lead"),
        projectRootSessionId: input.projectRootSessionId ?? input.sessionId,
      })
    }
    if (input.profile === ARCHITECT_OPENCODE) {
      return this.register({
        agentId: OUTER_ARCHITECT_ID,
        scope: "outer",
        profile: "architect",
        sessionId: input.sessionId,
        displayName: this.outerName("architect"),
        projectRootSessionId: input.projectRootSessionId,
      })
    }
    if (input.profile === CURATOR_OPENCODE) {
      return this.register({
        agentId: OUTER_CURATOR_ID,
        scope: "outer",
        profile: "curator",
        sessionId: input.sessionId,
        displayName: this.outerName("curator"),
        projectRootSessionId: input.projectRootSessionId,
      })
    }
    if (input.profile === ARBITER_OPENCODE) {
      return this.register({
        agentId: OUTER_ARBITER_ID,
        scope: "outer",
        profile: "arbiter",
        sessionId: input.sessionId,
        displayName: this.outerName("arbiter"),
        projectRootSessionId: input.projectRootSessionId,
      })
    }
  }

  syncRetroFromManifest(retro: RetroManifest, manifest: TreeManifest) {
    return this.mutate(() => {
      const projectRootSessionId = this.byProfile("lead", "outer")?.sessionId
      const synced: RegistryAgent[] = []
      for (const [nodeId, node] of Object.entries(retro.nodes)) {
        const execNode = manifest.nodes[nodeId]
        if (!execNode) continue
        synced.push(
          this.registerRetroNode({
            missionId: retro.mission_id,
            nodeId,
            sessionId: node.retro_session_id,
            profile: execNode.profile ?? INNER_EXECUTION_AGENT,
            projectRootSessionId,
          }),
        )
      }
      return synced
    })
  }

  registerRetroNode(input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  }) {
    return this.mutate(() => {
      const agentId = retroAgentId(input.missionId, input.nodeId)
      const existing = this.agents.get(agentId)
      const updatedAt = now()
      const record: RegistryAgent = {
        agentId,
        scope: "retro",
        profile: input.profile,
        sessionId: input.sessionId,
        displayName: sessionTitle(input.missionId, input.nodeId, true),
        missionId: input.missionId,
        nodeId: input.nodeId,
        status: "active",
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
        ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
          projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
        }),
      }
      this.agents.set(agentId, record)
      return record
    })
  }

  syncInnerFromManifest(manifest: TreeManifest) {
    const synced = this.mutate(() => {
      const projectRootSessionId = this.byProfile("lead", "outer")?.sessionId
      const agents: RegistryAgent[] = []
      for (const [nodeId, node] of Object.entries(manifest.nodes)) {
        const parentSessionId = node.parent ? manifest.nodes[node.parent]?.session_id : undefined
        agents.push(
          this.registerInnerNode({
            missionId: manifest.mission_id,
            nodeId,
            sessionId: node.session_id,
            profile: node.profile ?? INNER_EXECUTION_AGENT,
            parentSessionId,
            projectRootSessionId,
          }),
        )
      }
      return agents
    })
    return synced
  }

  registerInnerNode(input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    parentSessionId?: string
    projectRootSessionId?: string
  }) {
    return this.mutate(() => {
      const agentId = innerAgentId(input.missionId, input.nodeId)
      const existing = this.agents.get(agentId)
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
        ...(input.parentSessionId && { parentSessionId: input.parentSessionId }),
        ...((input.projectRootSessionId ?? existing?.projectRootSessionId) && {
          projectRootSessionId: input.projectRootSessionId ?? existing?.projectRootSessionId,
        }),
      }
      this.agents.set(agentId, record)
      return record
    })
  }

  byAgentId(agentId: string) {
    return this.agents.get(agentId)
  }

  bySession(sessionId: string) {
    return Array.from(this.agents.values()).find((agent) => agent.sessionId === sessionId && agent.status === "active")
  }

  byProfile(profile: string, scope?: RegistryScope) {
    const key = normalizeOuterProfile(profile)
    if (!key) return undefined
    return Array.from(this.agents.values()).find(
      (agent) =>
        agent.status === "active" &&
        agent.profile === key &&
        (scope === undefined || agent.scope === scope),
    )
  }

  list(input?: { scope?: RegistryScope; missionId?: string }) {
    return Array.from(this.agents.values()).filter((agent) => {
      if (agent.status !== "active") return false
      if (input?.scope && agent.scope !== input.scope) return false
      if (input?.missionId && agent.missionId !== input.missionId) return false
      return true
    })
  }

  pendingDeliveryCountForSession(sessionId: string) {
    return this.pendingDeliveries.filter((delivery) => delivery.recipientSessionId === sessionId).length
  }

  getActiveMission() {
    return this.db.getActiveMission()
  }

  activateMission(record: import("./types.ts").RegistryMissionRecord) {
    this.db.activateMission(record)
  }

  syncMissionRegistryStatus(missionId: string, status: string, completedAt?: string) {
    this.db.updateMissionStatus(missionId, status, completedAt)
    if (status === "done" || status === "cancelled") this.db.deactivateMission(missionId)
  }

  purgePendingDeliveriesForMission(missionId: string) {
    return this.mutate(() => {
      const before = this.pendingDeliveries.length
      this.pendingDeliveries = this.pendingDeliveries.filter((delivery) => {
        const recipient = this.byAgentId(delivery.recipientAgentId)
        if (!recipient?.missionId || recipient.missionId !== missionId) return true
        if (recipient.scope !== "inner" && recipient.scope !== "retro") return true
        return false
      })
      return before - this.pendingDeliveries.length
    })
  }

  resolveRecipient(query: string, opts: ResolveOptions = {}): RecipientResolution {
    const trimmed = query.trim()
    const normalized = trimmed.toLowerCase()
    const agents = Array.from(this.agents.values()).filter((agent) => {
      if (agent.status !== "active") return false
      if (opts.scope && agent.scope !== opts.scope) return false
      if (
        opts.missionId &&
        (agent.scope === "inner" || agent.scope === "retro") &&
        agent.missionId !== opts.missionId
      ) {
        return false
      }
      return true
    })

    const exactId = agents.find((agent) => agent.agentId === trimmed)
    if (exactId) return { status: "resolved", recipient: exactId, matchedBy: "agentId" }

    const exactSession = agents.find((agent) => agent.sessionId === trimmed)
    if (exactSession) return { status: "resolved", recipient: exactSession, matchedBy: "sessionId" }

    const targetProfile = normalizeOuterProfile(normalized)
    const profileMatches = agents.filter(
      (agent) => agent.scope === "outer" && targetProfile && agent.profile === targetProfile,
    )
    if (profileMatches.length === 1) return { status: "resolved", recipient: profileMatches[0]!, matchedBy: "profile" }

    if (opts.missionId) {
      const nodeMatches = agents.filter((agent) => agent.nodeId === trimmed && agent.missionId === opts.missionId)
      const nodeRecipient = pickNodeRecipient(nodeMatches, opts.sender)
      if (nodeRecipient) return { status: "resolved", recipient: nodeRecipient, matchedBy: "nodeId" }
      if (nodeMatches.length > 1) return { status: "ambiguous", query: trimmed, candidates: nodeMatches }
    }

    if (profileMatches.length > 1) return { status: "ambiguous", query: trimmed, candidates: profileMatches }

    const candidates = agents
      .filter(
        (agent) =>
          agent.agentId.toLowerCase().includes(normalized) ||
          agent.displayName.toLowerCase().includes(normalized) ||
          (agent.scope === "outer" && agent.profile.toLowerCase().includes(normalized)) ||
          agent.nodeId?.toLowerCase().includes(normalized),
      )
      .slice(0, 8)
    return { status: "not_found", query: trimmed, candidates }
  }

  async ensureArchitectSession(projectRootSessionId?: string) {
    const existing = this.byProfile("architect", "outer")
    if (existing?.sessionId) {
      if (await sessionExists(this.options.client, this.options.directory, existing.sessionId)) {
        this.syncOuterDisplayNames()
        return { agent: this.byProfile("architect", "outer") ?? existing, createdSession: false }
      }
      this.removeAgent(OUTER_ARCHITECT_ID)
    }
    const sessionId = await createSession(this.options.client, this.options.directory, {
      display_name: this.outerName("architect"),
      profile: ARCHITECT_OPENCODE,
      model: this.outerModel("architect"),
    })
    await promptSession(this.options.client, this.options.directory, sessionId, {
      profile: ARCHITECT_OPENCODE,
      system: await loadArchitectPrompt(this.options.directory),
      noReply: true,
      model: this.outerModel("architect"),
    }, this.options.plugin)
    const agent = this.register({
      agentId: OUTER_ARCHITECT_ID,
      scope: "outer",
      profile: "architect",
      sessionId,
      displayName: this.outerName("architect"),
      projectRootSessionId,
    })
    return { agent, createdSession: true }
  }

  async ensureCuratorSession(projectRootSessionId?: string) {
    const existing = this.byProfile("curator", "outer")
    if (existing?.sessionId) {
      if (await sessionExists(this.options.client, this.options.directory, existing.sessionId)) {
        this.syncOuterDisplayNames()
        return { agent: this.byProfile("curator", "outer") ?? existing, createdSession: false }
      }
      this.removeAgent(OUTER_CURATOR_ID)
    }
    const sessionId = await createSession(this.options.client, this.options.directory, {
      display_name: this.outerName("curator"),
      profile: CURATOR_OPENCODE,
      model: this.outerModel("curator"),
    })
    await promptSession(this.options.client, this.options.directory, sessionId, {
      profile: CURATOR_OPENCODE,
      system: await loadCuratorPrompt(this.options.directory),
      noReply: true,
      model: this.outerModel("curator"),
    }, this.options.plugin)
    const agent = this.register({
      agentId: OUTER_CURATOR_ID,
      scope: "outer",
      profile: "curator",
      sessionId,
      displayName: this.outerName("curator"),
      projectRootSessionId,
    })
    return { agent, createdSession: true }
  }

  async ensureArbiterSession(projectRootSessionId?: string) {
    const existing = this.byProfile("arbiter", "outer")
    if (existing?.sessionId) {
      if (await sessionExists(this.options.client, this.options.directory, existing.sessionId)) {
        this.syncOuterDisplayNames()
        return { agent: this.byProfile("arbiter", "outer") ?? existing, createdSession: false }
      }
      this.removeAgent(OUTER_ARBITER_ID)
    }
    const sessionId = await createSession(this.options.client, this.options.directory, {
      display_name: this.outerName("arbiter"),
      profile: ARBITER_OPENCODE,
      model: this.outerModel("arbiter"),
    })
    await promptSession(this.options.client, this.options.directory, sessionId, {
      profile: ARBITER_OPENCODE,
      system: await loadArbiterPrompt(this.options.directory),
      noReply: true,
      model: this.outerModel("arbiter"),
    }, this.options.plugin)
    const agent = this.register({
      agentId: OUTER_ARBITER_ID,
      scope: "outer",
      profile: "arbiter",
      sessionId,
      displayName: this.outerName("arbiter"),
      projectRootSessionId,
    })
    return { agent, createdSession: true }
  }

  async initOuterTeam(projectRootSessionId: string) {
    this.syncOuterDisplayNames()
    const architect = await this.ensureArchitectSession(projectRootSessionId)
    const curator = await this.ensureCuratorSession(projectRootSessionId)
    const arbiter = await this.ensureArbiterSession(projectRootSessionId)
    this.syncOuterDisplayNames()
    const names = readAgentNamesSync(this.options.directory)
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

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (input.senderProfile === LEAD_OPENCODE && !this.bySession(input.senderSessionId)) {
      const existingLead = this.byProfile("lead", "outer")
      if (!existingLead) {
        this.registerOuterSession({
          profile: LEAD_OPENCODE,
          sessionId: input.senderSessionId,
          projectRootSessionId: input.senderSessionId,
        })
        await this.syncOuterSessionTitle(input.senderSessionId, "lead")
      }
    }
    const resolvedSender = input.senderAgentId
      ? this.byAgentId(input.senderAgentId)
      : this.bySession(input.senderSessionId)
    if (!resolvedSender) {
      return { status: "forbidden", reason: "发送方 session 未在 registry 登记" }
    }

    const missionId = resolvedSender.missionId ?? this.getActiveMission()?.missionId
    const recipientResolution = this.resolveRecipient(input.recipientQuery, {
      missionId,
      sender: resolvedSender,
    })
    if (recipientResolution.status !== "resolved") return recipientResolution

    const recipient = recipientResolution.recipient
    if (recipient.sessionId === input.senderSessionId) return { status: "self", recipient }

    const forbidden = sendPolicyViolation(resolvedSender, recipient, readAgentNamesSync(this.options.directory))
    if (forbidden) {
      return {
        status: "forbidden",
        reason: forbidden,
        sender: resolvedSender,
        recipient,
      }
    }

    const senderLabel = resolvedSender.displayName
    const message = enrichLeadDeliveryMessage(this.options.directory, {
      sender: resolvedSender,
      recipient,
      message: input.message,
    })
    const delivery = await this.deliverToRecipient({
      recipient,
      promptText: formatDirectedNotification(this.options.directory, senderLabel, message),
      senderAgentId: resolvedSender.agentId ?? input.senderAgentId,
    })
    if (delivery.status === "failed") {
      return { status: "failed", recipient, error: delivery.error ?? "prompt failed" }
    }
    notifyWatchdogSendMessage(this.options.directory, {
      missionId,
      sender: resolvedSender,
      recipient,
    })
    return {
      status: delivery.status,
      recipient,
      sessionId: recipient.sessionId,
      createdSession: false,
    }
  }

  private emitPortalAgentChat(sender: RegistryAgent, recipient: RegistryAgent, text: string) {
    emitPortalEvent({
      type: "agent.chat",
      fromSpawnId: spawnIdForAgent(sender),
      toSpawnId: spawnIdForAgent(recipient),
      text,
    })
  }

  private emitPortalChat(
    recipient: RegistryAgent,
    promptText: string,
    options?: { suffix?: string; sender?: RegistryAgent },
  ) {
    const parsed = parseDirectedNotification(promptText)
    if (!parsed) return
    const sender = options?.sender
    if (!sender) return
    const suffix = options?.suffix ?? ""
    this.emitPortalAgentChat(sender, recipient, suffix ? `${parsed.text}${suffix}` : parsed.text)
  }

  beginRetroRun(missionId: string, expectedNodeIds: string[]) {
    return this.mutate(() => {
      for (const key of [...this.retroCompletions.keys()]) {
        if (key.startsWith(`${missionId}:`)) this.retroCompletions.delete(key)
      }
      const run: RegistryRetroRun = { missionId, expectedNodeIds, startedAt: now() }
      this.retroRuns.set(missionId, run)
      return run
    })
  }

  retroStatus(missionId: string) {
    const run = this.retroRuns.get(missionId)
    if (!run) return { status: "no_run" as const }
    const completed = run.expectedNodeIds.filter((nodeId) =>
      this.retroCompletions.has(retroCompletionKey(missionId, nodeId)),
    )
    const pending = run.expectedNodeIds.filter((nodeId) => !completed.includes(nodeId))
    const completions = completed.flatMap((nodeId) => {
      const item = this.retroCompletions.get(retroCompletionKey(missionId, nodeId))
      if (!item) return []
      return [{ node_id: nodeId, report_path: item.reportPath, completed_at: item.completedAt }]
    })
    return {
      status: "ok" as const,
      run,
      completed,
      pending,
      completions,
      allDone: pending.length === 0 && run.expectedNodeIds.length > 0,
      architectNotified: Boolean(run.architectNotifiedAt),
    }
  }

  async recordRetroCompletion(input: {
    missionId: string
    nodeId: string
    sessionId: string
    reportPath: string
  }) {
    const recorded = this.mutate(() => {
      const item: RegistryRetroCompletion = {
        missionId: input.missionId,
        nodeId: input.nodeId,
        reportPath: input.reportPath,
        sessionId: input.sessionId,
        completedAt: now(),
      }
      this.retroCompletions.set(retroCompletionKey(input.missionId, input.nodeId), item)
      return item
    })
    this.deactivateRetroAgentForNode(input.missionId, input.nodeId)
    await this.maybeNotifyApoRetroComplete(input.missionId)
    const after = this.retroStatus(input.missionId)
    if (after.status === "ok" && after.allDone) this.deactivateRetroAgentsForMission(input.missionId)
    return recorded
  }

  deactivateRetroAgentForNode(missionId: string, nodeId: string) {
    return this.mutate(() => {
      const agentId = retroAgentId(missionId, nodeId)
      const agent = this.agents.get(agentId)
      if (!agent || agent.status !== "active") return 0
      this.agents.set(agentId, { ...agent, status: "completed", updatedAt: now() })
      return 1
    })
  }

  deactivateRetroAgentsForMission(missionId: string) {
    return this.mutate(() => {
      const updatedAt = now()
      for (const [agentId, agent] of this.agents.entries()) {
        if (agent.scope !== "retro" || agent.missionId !== missionId || agent.status !== "active") continue
        this.agents.set(agentId, { ...agent, status: "completed", updatedAt })
      }
    })
  }

  async deliverSystemMessage(recipient: RegistryAgent, content: string, promptProfile?: string) {
    return this.deliverToRecipient({
      recipient,
      promptText: formatDirectedNotification(this.options.directory, "Gatehouse", content),
      promptProfile,
    })
  }

  async kickoffCuratorSkillAssignment(input: { missionId: string; objective?: string; spec: TeamSpec }) {
    const curator = this.byProfile("curator", "outer")
    if (!curator?.sessionId) {
      return {
        delivery: "failed" as const,
        error: "curator session not registered; lead must call gatehouse_init_team first",
      }
    }
    const promptText = formatDirectedNotification(
      this.options.directory,
      "Gatehouse",
      await loadCuratorSkillAssignKickoff(this.options.directory, {
        missionId: input.missionId,
        objective: input.objective,
        spec: input.spec,
      }),
    )
    const result = await this.deliverToRecipient({
      recipient: curator,
      promptText,
      promptProfile: curator.profile,
    })
    if (result.status !== "failed") {
      const architect = this.byProfile("architect", "outer")
      if (architect) {
        const locale = readLocaleSync(this.options.directory)
        this.emitPortalAgentChat(
          architect,
          curator,
          gatehouseMessage("portal.architectBootstrapCuratorHint", locale),
        )
      }
    }
    return {
      curator_session_id: curator.sessionId,
      delivery: result.status,
      ...(result.error && { error: result.error }),
    }
  }

  async kickoffExecSkillExtraction(manifest: TreeManifest, input: { spec?: TeamSpec; briefDomainIds?: string[] }) {
    const targets = execSkillKickoffTargets(manifest, input)
    this.beginSkillExtractRun(
      manifest.mission_id,
      targets.map((target) => target.nodeId),
    )
    const deliveries: Array<{ nodeId: string; skillDomain: string; delivery: "sent" | "queued" | "failed"; error?: string }> = []
    for (const target of execSkillKickoffTargets(manifest, input)) {
      const recipient = this.byAgentId(innerAgentId(manifest.mission_id, target.nodeId))
      if (!recipient) {
        deliveries.push({
          nodeId: target.nodeId,
          skillDomain: target.skillDomain,
          delivery: "failed",
          error: "exec agent not in registry",
        })
        continue
      }
      const content = await loadDomainSkillExtractPrompt(this.options.directory, {
        missionId: manifest.mission_id,
        nodeId: target.nodeId,
        skillDomain: target.skillDomain,
      })
      const result = await this.deliverSystemMessage(recipient, content)
      deliveries.push({
        nodeId: target.nodeId,
        skillDomain: target.skillDomain,
        delivery: result.status,
        ...(result.error && { error: result.error }),
      })
    }
    return deliveries
  }

  async kickoffRetroSessions(manifest: TreeManifest, retroOrder: string[]) {
    const deliveries: Array<{ nodeId: string; delivery: "sent" | "queued" | "failed"; error?: string }> = []
    for (const nodeId of retroOrder) {
      const execNode = manifest.nodes[nodeId]
      const recipient = this.byAgentId(retroAgentId(manifest.mission_id, nodeId))
      if (!execNode || !recipient) {
        deliveries.push({ nodeId, delivery: "failed", error: "retro agent not in registry" })
        continue
      }
      const promptText = await loadRetroKickoffPrompt(this.options.directory, {
        missionId: manifest.mission_id,
        nodeId,
        manifest,
      })
      const result = await this.deliverToRecipient({
        recipient,
        promptText,
        promptProfile: recipient.profile,
      })
      deliveries.push({
        nodeId,
        delivery: result.status,
        ...(result.error && { error: result.error }),
      })
    }
    return deliveries
  }

  private async maybeNotifyApoRetroComplete(missionId: string) {
    const status = this.retroStatus(missionId)
    if (status.status !== "ok" || !status.allDone || status.architectNotified) return
    const architect = this.byProfile("architect", "outer")
    if (!architect) return
    const completions = status.completed.map((nodeId) => {
      const item = this.retroCompletions.get(retroCompletionKey(missionId, nodeId))
      return { nodeId, reportPath: item?.reportPath ?? retroNodeReportRelPath(missionId, nodeId) }
    })
    const sent = await this.deliverSystemMessage(
      architect,
      architectRetroBatchReadyMessage(
        missionId,
        completions,
        readAgentNamesSync(this.options.directory),
        readLocaleSync(this.options.directory),
      ),
    )
    if (sent.status === "failed") return
    this.mutate(() => {
      const run = this.retroRuns.get(missionId)
      if (!run) return
      this.retroRuns.set(missionId, { ...run, architectNotifiedAt: now() })
    })
  }

  beginSkillExtractRun(missionId: string, expectedNodeIds: string[]) {
    return this.mutate(() => {
      for (const key of [...this.skillExtractCompletions.keys()]) {
        if (key.startsWith(`${missionId}:`)) this.skillExtractCompletions.delete(key)
      }
      const run: RegistrySkillExtractRun = { missionId, expectedNodeIds, startedAt: now() }
      this.skillExtractRuns.set(missionId, run)
      return run
    })
  }

  skillExtractStatus(missionId: string) {
    const run = this.skillExtractRuns.get(missionId)
    if (!run) return { status: "no_run" as const }
    const completed = run.expectedNodeIds.filter((nodeId) =>
      this.skillExtractCompletions.has(skillExtractCompletionKey(missionId, nodeId)),
    )
    const pending = run.expectedNodeIds.filter((nodeId) => !completed.includes(nodeId))
    const completions = completed.flatMap((nodeId) => {
      const item = this.skillExtractCompletions.get(skillExtractCompletionKey(missionId, nodeId))
      if (!item) return []
      return [{ node_id: nodeId, summary_path: item.summaryPath, completed_at: item.completedAt }]
    })
    return {
      status: "ok" as const,
      run,
      completed,
      pending,
      completions,
      allDone: pending.length === 0 && run.expectedNodeIds.length > 0,
      curatorNotified: Boolean(run.curatorNotifiedAt),
    }
  }

  listIncompleteRetroRecordRuns() {
    return [...this.retroRuns.keys()].flatMap((missionId) => {
      const status = this.retroStatus(missionId)
      if (status.status !== "ok" || status.allDone) return []
      return [{
        missionId,
        expectedNodeIds: status.run.expectedNodeIds,
        pendingNodeIds: status.pending,
      }]
    })
  }

  listIncompleteSkillExtractRecordRuns() {
    return [...this.skillExtractRuns.keys()].flatMap((missionId) => {
      const status = this.skillExtractStatus(missionId)
      if (status.status !== "ok" || status.allDone) return []
      return [{
        missionId,
        expectedNodeIds: status.run.expectedNodeIds,
        pendingNodeIds: status.pending,
      }]
    })
  }

  async recordSkillExtractCompletion(input: {
    missionId: string
    nodeId: string
    sessionId: string
    summaryPath?: string
  }) {
    const recorded = this.mutate(() => {
      const item: RegistrySkillExtractCompletion = {
        missionId: input.missionId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        completedAt: now(),
        ...(input.summaryPath && { summaryPath: input.summaryPath }),
      }
      this.skillExtractCompletions.set(skillExtractCompletionKey(input.missionId, input.nodeId), item)
      return item
    })
    await this.maybeNotifyCuratorSkillExtractComplete(input.missionId)
    return recorded
  }

  private async maybeNotifyCuratorSkillExtractComplete(missionId: string) {
    const status = this.skillExtractStatus(missionId)
    if (status.status !== "ok" || !status.allDone || status.curatorNotified) return
    const curator = this.byProfile("curator", "outer")
    if (!curator?.sessionId) return
    const completions = status.completed.map((nodeId) => {
      const item = this.skillExtractCompletions.get(skillExtractCompletionKey(missionId, nodeId))
      return { nodeId, summaryPath: item?.summaryPath ?? curatorSkillSummaryRelPath(missionId, nodeId) }
    })
    const sent = await this.deliverSystemMessage(
      curator,
      curatorSkillExtractBatchReadyMessage(
        missionId,
        completions,
        readAgentNamesSync(this.options.directory),
        readLocaleSync(this.options.directory),
      ),
    )
    if (sent.status === "failed") return
    this.mutate(() => {
      const run = this.skillExtractRuns.get(missionId)
      if (!run) return
      this.skillExtractRuns.set(missionId, { ...run, curatorNotifiedAt: now() })
    })
  }

  /** System / runtime delivery (execution work orders, kickoff). */
  async deliverSystemPrompt(
    recipient: RegistryAgent,
    promptText: string,
    options?: { promptProfile?: string; senderAgentId?: string },
  ) {
    return this.deliverToRecipient({
      recipient,
      promptText,
      ...(options?.promptProfile && { promptProfile: options.promptProfile }),
      ...(options?.senderAgentId && { senderAgentId: options.senderAgentId }),
    })
  }

  private async deliverToRecipient(input: {
    recipient: RegistryAgent
    promptText: string
    promptProfile?: string
    senderAgentId?: string
  }) {
    const sender = input.senderAgentId ? this.byAgentId(input.senderAgentId) : undefined
    const portalChat = (suffix?: string) =>
      this.emitPortalChat(input.recipient, input.promptText, { sender, ...(suffix && { suffix }) })
    const busy = await this.busySessionIds()
    if (busy.has(input.recipient.sessionId)) {
      this.enqueueDelivery({
        recipient: input.recipient,
        senderAgentId: input.senderAgentId,
        promptText: input.promptText,
        promptProfile: input.promptProfile ?? input.recipient.profile,
      })
      portalChat("（排队投递）")
      return { status: "queued" as const }
    }
    const sent = await this.sendPrompt(input.recipient, input.promptText, input.promptProfile)
    if (sent.status === "failed") return { status: "failed" as const, error: sent.error }
    portalChat()
    return { status: "sent" as const }
  }

  private enqueueDelivery(input: {
    recipient: RegistryAgent
    senderAgentId?: string
    promptText: string
    promptProfile?: string
  }) {
    this.mutate(() => {
      this.pendingDeliveries = [
        ...this.pendingDeliveries,
        {
          id: crypto.randomUUID(),
          recipientSessionId: input.recipient.sessionId,
          recipientAgentId: input.recipient.agentId,
          promptText: input.promptText,
          createdAt: now(),
          ...(input.senderAgentId && { senderAgentId: input.senderAgentId }),
          ...(input.promptProfile && { promptProfile: input.promptProfile }),
        },
      ]
    })
  }

  private async sendPrompt(recipient: RegistryAgent, promptText: string, promptProfile?: string) {
    try {
      await promptSession(this.options.client, this.options.directory, recipient.sessionId, {
        text: promptText,
        profile: promptProfile ?? recipient.profile,
      }, this.options.plugin)
      return { status: "sent" as const }
    } catch (error) {
      return { status: "failed" as const, error: errorMessage(error) }
    }
  }

  flushPendingDeliveries() {
    const run = this.flushTail.then(() => this.flushPendingDeliveriesOnce())
    this.flushTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async flushPendingDeliveriesOnce() {
    this.loadSnapshot()
    const nowIso = now()
    const busy = await this.busySessionIds()
    const recipients = [
      ...new Set(
        this.pendingDeliveries
          .filter((delivery) => pendingEligible(delivery, nowIso))
          .map((delivery) => delivery.recipientSessionId),
      ),
    ].sort()

    for (const recipientSessionId of recipients) {
      if (busy.has(recipientSessionId)) continue
      await this.flushRecipientFifo(recipientSessionId, nowIso)
    }
  }

  private async flushRecipientFifo(recipientSessionId: string, nowIso: string) {
    for (;;) {
      this.loadSnapshot()
      const batch = this.pendingDeliveries
        .filter(
          (delivery) => delivery.recipientSessionId === recipientSessionId && pendingEligible(delivery, nowIso),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      const next = batch[0]
      if (!next) return

      const recipient = this.byAgentId(next.recipientAgentId)
      if (!recipient) {
        this.mutate(() => {
          this.pendingDeliveries = this.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
        })
        continue
      }

      const sent = await this.sendPrompt(recipient, next.promptText, next.promptProfile)
      if (sent.status === "sent") {
        const sender = next.senderAgentId ? this.byAgentId(next.senderAgentId) : undefined
        this.emitPortalChat(recipient, next.promptText, { sender })
        this.mutate(() => {
          this.pendingDeliveries = this.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
        })
        continue
      }

      const attempts = (next.attempts ?? 0) + 1
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.mutate(() => {
          this.pendingDeliveries = this.pendingDeliveries.filter((delivery) => delivery.id !== next.id)
        })
        return
      }

      this.mutate(() => {
        this.pendingDeliveries = this.pendingDeliveries.map((delivery) =>
          delivery.id === next.id
            ? {
                ...delivery,
                attempts,
                lastAttemptAt: nowIso,
                lastError: sent.error,
                nextRetryAt: new Date(Date.now() + deliveryBackoffMs(attempts)).toISOString(),
              }
            : delivery,
        )
      })
      return
    }
  }

  private async busySessionIds() {
    const map =
      (await sessionStatusById(this.options.client, this.options.directory, this.options.plugin)) ??
      new Map<string, import("../session/status.ts").SessionRuntimeStatus>()
    return new Set(
      [...map.entries()]
        .filter(([, status]) => status === "busy" || status === "retry")
        .map(([sessionId]) => sessionId),
    )
  }
}

function pickNodeRecipient(matches: RegistryAgent[], sender?: RegistryAgent) {
  if (matches.length === 1) return matches[0]
  if (matches.length < 2) return undefined
  if (sender?.scope === "outer" && sender.profile === "architect") {
    const retro = matches.filter((agent) => agent.scope === "retro")
    if (retro.length === 1) return retro[0]
  }
  if (sender?.scope === "inner") {
    const inner = matches.filter((agent) => agent.scope === "inner")
    if (inner.length === 1) return inner[0]
  }
  return undefined
}

function sendPolicyViolation(
  sender: RegistryAgent,
  recipient: RegistryAgent,
  names: Record<OuterProfile, string>,
) {
  if (sender.scope === "outer" && sender.profile === "lead") {
    if (recipient.scope === "outer" && (recipient.profile === "architect" || recipient.profile === "curator")) return undefined
    if (isInnerStructuralRoot(recipient)) return undefined
    return `profile lead (${names.lead}) may only message architect (${names.architect}), curator (${names.curator}), or the structural root`
  }
  if (sender.scope === "outer" && sender.profile === "architect") {
    if (recipient.scope === "outer" && recipient.profile !== "architect") return undefined
    if (recipient.scope === "inner") return undefined
    return `profile architect (${names.architect}) may only message lead (${names.lead}) or execution-tree sessions`
  }
  if (sender.scope === "outer" && sender.profile === "curator") {
    if (recipient.scope === "outer" && recipient.profile === "lead") return undefined
    if (recipient.scope === "inner") return undefined
    return `profile curator (${names.curator}) may only message lead (${names.lead}) or execution-tree sessions`
  }
  if (sender.scope === "inner") {
    if (recipient.scope === "outer" && recipient.profile === "lead") {
      if (sender.parentSessionId) {
        return `only profile build-root (structural root) may notify lead (${names.lead}) of mission completion`
      }
      if (!innerProfileMayNotifyLead(sender.profile)) {
        return `only profile build-root or build-root-solo (structural root) may notify lead (${names.lead}); got profile ${sender.profile}`
      }
      return undefined
    }
    if (recipient.scope === "outer") return "execution-tree nodes may only message peers in the same mission"
    if (sender.missionId !== recipient.missionId) return "execution-tree nodes may only message peers in the same mission"
    return undefined
  }
  if (sender.scope === "retro") return "retro sessions must use gatehouse_retro_record instead of send_message"
  return "sender is not allowed to use gatehouse_send_message"
}
