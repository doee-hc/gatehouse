import { RegistryDatabase } from "./db.ts"
import { bindWatchdogStateStore } from "../watchdog/state-store.ts"
import { normalizeOuterProfile } from "../names.ts"
import type { MissionExtractManifest, MissionManifest, MissionRetroManifest, MissionTeamSpec, MissionVerifyManifest } from "../missions/manifest/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import type { OuterProfile } from "../names.ts"
import {
  REGISTRY_SCHEMA_VERSION,
  type DeliverSystemNotificationInput,
  type RegisterAgentInput,
  type RegistryAgent,
  type RegistryScope,
  type SendMessageInput,
  type SendMessageResult,
} from "./types.ts"
import { now, skillExtractCompletionKey, skillVerifyCompletionKey } from "./helpers.ts"
import type { RecipientResolution, RegistryHost, RegistryState, ResolveOptions, StoreOptions } from "./internals.ts"
import * as agentRegistry from "./agent-registry.ts"
import * as extractService from "./extract-service.ts"
import * as messagingService from "./messaging-service.ts"
import * as retroService from "./retro-service.ts"
import * as sessionFactory from "./session-factory.ts"

export type { StoreOptions } from "./internals.ts"

export class RegistryStore {
  readonly dbPath: string
  private db: RegistryDatabase
  private readonly state: RegistryState

  private constructor(private options: StoreOptions) {
    this.db = new RegistryDatabase(options.directory)
    this.dbPath = this.db.path
    this.state = {
      agents: new Map(),
      pendingDeliveries: [],
      retroRuns: new Map(),
      skillExtractRuns: new Map(),
      skillExtractCompletions: new Map(),
      skillVerifyRuns: new Map(),
      skillVerifyCompletions: new Map(),
      flushTail: Promise.resolve(),
    }
  }

  get directory() {
    return this.options.directory
  }

  private host(): RegistryHost {
    const store = this
    return {
      directory: store.options.directory,
      options: store.options,
      state: store.state,
      mutate: (fn) => store.mutate(fn),
      loadSnapshot: () => store.loadSnapshot(),
      removeAgent: (agentId) => store.removeAgent(agentId),
      register: (input) => store.register(input),
      byAgentId: (agentId) => store.byAgentId(agentId),
      bySession: (sessionId) => store.bySession(sessionId),
      byProfile: (profile, scope) => store.byProfile(profile, scope),
      getActiveMission: () => store.getActiveMission(),
      resolveRecipient: (query, opts) => messagingService.resolveRecipient(store.host(), query, opts),
    }
  }

  static async create(options: StoreOptions) {
    const store = new RegistryStore(options)
    store.loadSnapshot()
    bindWatchdogStateStore(options.directory, store.db)
    return store
  }

  private loadSnapshot() {
    const snapshot = this.db.load()
    this.state.agents = new Map(snapshot.agents.map((item) => [item.agentId, item]))
    this.state.pendingDeliveries = snapshot.pendingDeliveries
    this.state.retroRuns = new Map(snapshot.retroRuns.map((item) => [item.missionId, item]))
    this.state.skillExtractRuns = new Map(snapshot.skillExtractRuns.map((item) => [item.missionId, item]))
    this.state.skillExtractCompletions = new Map(
      snapshot.skillExtractCompletions.map((item) => [skillExtractCompletionKey(item.missionId, item.nodeId), item]),
    )
    this.state.skillVerifyRuns = new Map(snapshot.skillVerifyRuns.map((item) => [item.missionId, item]))
    this.state.skillVerifyCompletions = new Map(
      snapshot.skillVerifyCompletions.map((item) => [skillVerifyCompletionKey(item.missionId, item.nodeId), item]),
    )
  }

  private memorySnapshot() {
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: now(),
      agents: Array.from(this.state.agents.values()),
      pendingDeliveries: [...this.state.pendingDeliveries],
      retroRuns: Array.from(this.state.retroRuns.values()),
      skillExtractRuns: Array.from(this.state.skillExtractRuns.values()),
      skillExtractCompletions: Array.from(this.state.skillExtractCompletions.values()),
      skillVerifyRuns: Array.from(this.state.skillVerifyRuns.values()),
      skillVerifyCompletions: Array.from(this.state.skillVerifyCompletions.values()),
    }
  }

  private mutate<T>(fn: () => T) {
    const result = fn()
    this.db.save(this.memorySnapshot())
    return result
  }

  private removeAgent(agentId: string) {
    this.mutate(() => {
      this.state.agents.delete(agentId)
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
        createdAt: this.state.agents.get(input.agentId)?.createdAt ?? updatedAt,
        updatedAt,
        ...(input.missionId && { missionId: input.missionId }),
        ...(input.nodeId && { nodeId: input.nodeId }),
        ...(input.projectRootSessionId && { projectRootSessionId: input.projectRootSessionId }),
      }
      this.state.agents.set(input.agentId, record)
      return record
    })
  }

  registerOuterSession(input: { profile: string; sessionId: string; projectRootSessionId?: string }) {
    return agentRegistry.registerOuterSession(this.host(), input)
  }

  syncRetroFromManifest(retro: MissionRetroManifest) {
    return agentRegistry.syncRetroFromManifest(this.host(), retro)
  }

  registerRetroAnalyst(input: { missionId: string; sessionId: string; projectRootSessionId?: string }) {
    return agentRegistry.registerRetroAnalyst(this.host(), input)
  }

  registerExtractNode(input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  }) {
    return agentRegistry.registerExtractNode(this.host(), input)
  }

  registerVerifyNode(input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  }) {
    return agentRegistry.registerVerifyNode(this.host(), input)
  }

  syncExtractFromManifest(extract: MissionExtractManifest, manifest: MissionManifest) {
    return agentRegistry.syncExtractFromManifest(this.host(), extract, manifest)
  }

  syncVerifyFromManifest(verify: MissionVerifyManifest) {
    return agentRegistry.syncVerifyFromManifest(this.host(), verify)
  }

  syncInnerFromManifest(manifest: MissionManifest) {
    return agentRegistry.syncInnerFromManifest(this.host(), manifest)
  }

  registerInnerNode(input: {
    missionId: string
    nodeId: string
    sessionId: string
    profile: string
    projectRootSessionId?: string
  }) {
    return agentRegistry.registerInnerNode(this.host(), input)
  }

  byAgentId(agentId: string) {
    return this.state.agents.get(agentId)
  }

  bySession(sessionId: string) {
    return Array.from(this.state.agents.values()).find((agent) => agent.sessionId === sessionId && agent.status === "active")
  }

  byProfile(profile: string, scope?: RegistryScope) {
    const key = normalizeOuterProfile(profile)
    if (!key) return undefined
    return Array.from(this.state.agents.values()).find(
      (agent) => agent.status === "active" && agent.scope === (scope ?? "outer") && agent.profile === key,
    )
  }

  list(input?: { scope?: RegistryScope; missionId?: string }) {
    return Array.from(this.state.agents.values()).filter((agent) => {
      if (agent.status !== "active") return false
      if (input?.scope && agent.scope !== input.scope) return false
      if (input?.missionId && agent.missionId !== input.missionId) return false
      return true
    })
  }

  pendingDeliveryCountForSession(sessionId: string) {
    return this.state.pendingDeliveries.filter((delivery) => delivery.recipientSessionId === sessionId).length
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
      let removed = 0
      this.state.pendingDeliveries = this.state.pendingDeliveries.filter((delivery) => {
        const recipient = this.byAgentId(delivery.recipientAgentId)
        if (!recipient?.missionId || recipient.missionId !== missionId) return true
        if (recipient.scope !== "inner" && recipient.scope !== "retro") return true
        removed += 1
        return false
      })
      return removed
    })
  }

  resolveRecipient(query: string, opts: ResolveOptions = {}): RecipientResolution {
    return messagingService.resolveRecipient(this.host(), query, opts)
  }

  async syncOuterSessionTitle(sessionId: string, profile: OuterProfile) {
    return sessionFactory.syncOuterSessionTitle(this.host(), sessionId, profile)
  }

  syncOuterDisplayNames() {
    return sessionFactory.syncOuterDisplayNames(this.host())
  }

  async ensureArchitectSession(projectRootSessionId?: string) {
    return sessionFactory.ensureArchitectSession(this.host(), projectRootSessionId)
  }

  async ensureCuratorSession(projectRootSessionId?: string) {
    return sessionFactory.ensureCuratorSession(this.host(), projectRootSessionId)
  }

  async ensureArbiterSession(projectRootSessionId?: string) {
    return sessionFactory.ensureArbiterSession(this.host(), projectRootSessionId)
  }

  async initOuterTeam(projectRootSessionId: string) {
    return sessionFactory.initOuterTeam(this.host(), projectRootSessionId)
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return messagingService.sendMessage(this.host(), input)
  }

  deliverSystemNotification(input: DeliverSystemNotificationInput): Promise<SendMessageResult> {
    return messagingService.deliverSystemNotification(this.host(), input)
  }

  deliverSystemMessage(recipient: RegistryAgent, content: string, promptProfile?: string) {
    return messagingService.deliverSystemMessage(this.host(), recipient, content, promptProfile)
  }

  deliverSystemPrompt(
    recipient: RegistryAgent,
    promptText: string,
    options?: { promptProfile?: string; senderAgentId?: string },
  ) {
    return messagingService.deliverSystemPrompt(this.host(), recipient, promptText, options)
  }

  flushPendingDeliveries() {
    return messagingService.flushPendingDeliveries(this.host())
  }

  beginRetroRun(missionId: string) {
    return retroService.beginRetroRun(this.host(), missionId)
  }

  retroStatus(missionId: string) {
    return retroService.retroStatus(this.host(), missionId)
  }

  retroCompleteReadiness(missionId: string) {
    return retroService.retroCompleteReadiness(this.host(), missionId)
  }

  recordArchitectRetroSummary(input: { missionId: string; reportPath: string }) {
    return retroService.recordArchitectRetroSummary(this.host(), input)
  }

  recordCuratorSkillSummary(input: { missionId: string; reportPath: string }) {
    return retroService.recordCuratorSkillSummary(this.host(), input)
  }

  recordRetroSummary(input: { missionId: string; sessionId: string; reportPath: string }) {
    return retroService.recordRetroSummary(this.host(), input)
  }

  kickoffRetroSession(manifest: MissionManifest, plan?: OrchestrationPlan) {
    return retroService.kickoffRetroSession(this.host(), manifest, plan)
  }

  listIncompleteRetroRecordRuns() {
    return retroService.listIncompleteRetroRecordRuns(this.host())
  }

  deactivateRetroAgent(missionId: string) {
    return agentRegistry.deactivateRetroAgent(this.host(), missionId)
  }

  deactivateRetroAgentsForMission(missionId: string) {
    return agentRegistry.deactivateRetroAgent(this.host(), missionId)
  }

  beginSkillExtractRun(missionId: string, expectedNodeIds: string[]) {
    return extractService.beginSkillExtractRun(this.host(), missionId, expectedNodeIds)
  }

  skillExtractStatus(missionId: string) {
    return extractService.skillExtractStatus(this.host(), missionId)
  }

  beginSkillVerifyRun(missionId: string, expectedNodeIds: string[]) {
    return extractService.beginSkillVerifyRun(this.host(), missionId, expectedNodeIds)
  }

  skillVerifyStatus(missionId: string) {
    return extractService.skillVerifyStatus(this.host(), missionId)
  }

  listIncompleteSkillVerifyRecordRuns() {
    return extractService.listIncompleteSkillVerifyRecordRuns(this.host())
  }

  listIncompleteSkillExtractRecordRuns() {
    return extractService.listIncompleteSkillExtractRecordRuns(this.host())
  }

  recordSkillExtractCompletion(input: {
    missionId: string
    nodeId: string
    sessionId: string
    summaryPath?: string
  }) {
    return extractService.recordSkillExtractCompletion(this.host(), input)
  }

  recordSkillVerifyCompletion(input: {
    missionId: string
    nodeId: string
    sessionId: string
    passed: boolean
    reportPath?: string
  }) {
    return extractService.recordSkillVerifyCompletion(this.host(), input)
  }

  kickoffCuratorSkillAssignment(input: { missionId: string; objective?: string; spec: MissionTeamSpec }) {
    return extractService.kickoffCuratorSkillAssignment(this.host(), input)
  }

  kickoffExtractSkillSessions(extract: MissionExtractManifest) {
    return extractService.kickoffExtractSkillSessions(this.host(), extract)
  }

  kickoffSkillVerifySessions(verify: MissionVerifyManifest) {
    return extractService.kickoffSkillVerifySessions(this.host(), verify)
  }

  deactivateExtractAgentForNode(missionId: string, nodeId: string) {
    return agentRegistry.deactivateExtractAgentForNode(this.host(), missionId, nodeId)
  }

  deactivateVerifyAgentForNode(missionId: string, nodeId: string) {
    return agentRegistry.deactivateVerifyAgentForNode(this.host(), missionId, nodeId)
  }

  deactivateVerifyAgentsForMission(missionId: string) {
    return agentRegistry.deactivateVerifyAgentsForMission(this.host(), missionId)
  }
}
