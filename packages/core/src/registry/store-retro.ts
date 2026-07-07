import type { MissionManifest, MissionRetroManifest } from "../missions/manifest/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import type { RegistryHost } from "./internals.ts"
import * as agentRegistry from "./agent-registry.ts"
import * as retroService from "./retro-service.ts"

export class RegistryStoreRetro {
  constructor(private readonly host: () => RegistryHost) {}

  syncRetroFromManifest(retro: MissionRetroManifest) {
    return agentRegistry.syncRetroFromManifest(this.host(), retro)
  }

  registerRetroAnalyst(input: { missionId: string; sessionId: string; projectRootSessionId?: string }) {
    return agentRegistry.registerRetroAnalyst(this.host(), input)
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
}
