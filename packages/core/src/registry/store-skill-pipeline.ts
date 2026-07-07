import type {
  MissionExtractManifest,
  MissionManifest,
  MissionTeamSpec,
  MissionVerifyManifest,
} from "../missions/manifest/types.ts"
import type { RegistryHost } from "./internals.ts"
import * as agentRegistry from "./agent-registry.ts"
import * as extractService from "./extract-service.ts"

export class RegistryStoreSkillPipeline {
  constructor(private readonly host: () => RegistryHost) {}

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
