import type { Database } from "bun:sqlite"
import type { MissionRetroManifest, MissionManifest } from "../missions/manifest/types.ts"
import type { MissionExtractManifest, MissionVerifyManifest } from "../missions/manifest/types.ts"
import type { OrchestrationState } from "../orchestration/types.ts"
import type { MissionScriptMeta } from "../orchestration/types.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import type { DeliveryDocument } from "../delivery/types.ts"
import type { WatchdogKind } from "../watchdog/state-db.ts"
import type { MissionWatchState } from "../watchdog/signals.ts"
import type { RegistryMissionRecord } from "./types.ts"
import {
  findMissionManifestByExecSession,
  findMissionManifestByRetroSession,
  findMissionManifestByExtractSession,
  findMissionManifestByVerifySession,
  getRetroManifest,
  getExtractManifest,
  getVerifyManifest,
  getMissionManifest,
  listMissionIds,
  listMissionManifestIndex,
  saveRetroManifest,
  saveExtractManifest,
  saveVerifyManifest,
  saveMissionManifest,
} from "./mission-manifest-db.ts"
import {
  readMissionContractRaw,
  readNodeBrief,
  saveMissionContractRaw,
  saveNodeBrief,
  listNodeBriefIds,
} from "./mission-artifacts-db.ts"
import {
  mutateOrchestrationState as persistMutateOrchestrationState,
  readMissionScript,
  readOrchestrationState,
  readOrchestrationPlan,
  readLatestOrchestrationPlan,
  readOrchestrationBaseline,
  saveMissionScript as persistMissionScript,
  saveOrchestrationState as persistOrchestrationState,
  saveOrchestrationPlan as persistOrchestrationPlan,
  saveOrchestrationBaseline as persistOrchestrationBaseline,
} from "./orchestration-db.ts"
import {
  deleteWatchdogState as deleteWatchdogStateRow,
  loadAllWatchdogStates,
  saveWatchdogState as saveWatchdogStateRow,
} from "../watchdog/state-db.ts"
import {
  readDeliveryDocumentFromDb,
  writeDeliveryDocumentToDb,
} from "../delivery/db.ts"
import {
  activateMission as persistActivateMission,
  deactivateMission as persistDeactivateMission,
  getActiveMission as readActiveMission,
  getMission as readMission,
  updateMissionStatus as persistUpdateMissionStatus,
} from "./missions-db.ts"

export function attachManifestDb(db: Database) {
  return {
    getMissionManifest(missionId: string) {
      return getMissionManifest(db, missionId)
    },
    saveMissionManifest(manifest: MissionManifest) {
      return saveMissionManifest(db, manifest)
    },
    listMissionIds(status?: MissionManifest["status"]) {
      return listMissionIds(db, status)
    },
    listMissionManifestIndex() {
      return listMissionManifestIndex(db)
    },
    findMissionManifestByExecSession(sessionId: string) {
      return findMissionManifestByExecSession(db, sessionId)
    },
    getRetroManifest(missionId: string) {
      return getRetroManifest(db, missionId)
    },
    saveRetroManifest(retro: MissionRetroManifest) {
      return saveRetroManifest(db, retro)
    },
    getExtractManifest(missionId: string) {
      return getExtractManifest(db, missionId)
    },
    saveExtractManifest(extract: MissionExtractManifest) {
      return saveExtractManifest(db, extract)
    },
    getVerifyManifest(missionId: string) {
      return getVerifyManifest(db, missionId)
    },
    saveVerifyManifest(verify: MissionVerifyManifest) {
      return saveVerifyManifest(db, verify)
    },
    findMissionManifestByRetroSession(sessionId: string) {
      return findMissionManifestByRetroSession(db, sessionId)
    },
    findMissionManifestByExtractSession(sessionId: string) {
      return findMissionManifestByExtractSession(db, sessionId)
    },
    findMissionManifestByVerifySession(sessionId: string) {
      return findMissionManifestByVerifySession(db, sessionId)
    },
  }
}

export function attachMissionRegistryDb(db: Database) {
  return {
    getActiveMission() {
      return readActiveMission(db)
    },
    getMission(missionId: string) {
      return readMission(db, missionId)
    },
    activateMission(record: RegistryMissionRecord) {
      persistActivateMission(db, record)
    },
    updateMissionStatus(missionId: string, status: string, completedAt?: string) {
      persistUpdateMissionStatus(db, missionId, status, completedAt)
    },
    deactivateMission(missionId: string) {
      persistDeactivateMission(db, missionId)
    },
  }
}

export function attachOrchestrationDb(db: Database) {
  return {
    saveMissionScript(input: {
      missionId: string
      team: MissionTeamSpec
      meta?: MissionScriptMeta
      scriptPath?: string
      scriptHash?: string
    }) {
      persistMissionScript(db, input)
    },
    getMissionScript(missionId: string) {
      return readMissionScript(db, missionId)
    },
    saveOrchestrationState(state: OrchestrationState) {
      persistOrchestrationState(db, state)
    },
    getOrchestrationState(missionId: string) {
      return readOrchestrationState(db, missionId)
    },
    mutateOrchestrationState(missionId: string, mutator: (state: OrchestrationState) => void) {
      return persistMutateOrchestrationState(db, missionId, mutator)
    },
    saveOrchestrationPlan(plan: import("../orchestration/plan/types.ts").OrchestrationPlan) {
      persistOrchestrationPlan(db, plan)
    },
    getOrchestrationPlan(missionId: string, planVersion: string) {
      return readOrchestrationPlan(db, missionId, planVersion)
    },
    getLatestOrchestrationPlan(missionId: string) {
      return readLatestOrchestrationPlan(db, missionId)
    },
    saveOrchestrationBaseline(baseline: import("../orchestration/plan/types.ts").OrchestrationBaseline) {
      persistOrchestrationBaseline(db, baseline)
    },
    getOrchestrationBaseline(baselineId: string) {
      return readOrchestrationBaseline(db, baselineId)
    },
  }
}

export function attachMissionArtifactsDb(db: Database) {
  return {
    saveMissionContractRaw(missionId: string, contractRaw: unknown) {
      saveMissionContractRaw(db, missionId, contractRaw)
    },
    getMissionContractRaw(missionId: string) {
      return readMissionContractRaw(db, missionId)
    },
    saveNodeBrief(missionId: string, nodeId: string, brief: import("../execution/types.ts").NodeBrief) {
      saveNodeBrief(db, missionId, nodeId, brief)
    },
    getNodeBrief(missionId: string, nodeId: string) {
      return readNodeBrief(db, missionId, nodeId)
    },
    listNodeBriefIds(missionId: string) {
      return listNodeBriefIds(db, missionId)
    },
  }
}

export function attachWatchdogDb(db: Database) {
  return {
    loadWatchdogStates() {
      return loadAllWatchdogStates(db)
    },
    saveWatchdogState(missionId: string, kind: WatchdogKind, state: MissionWatchState) {
      saveWatchdogStateRow(db, missionId, kind, state)
    },
    deleteWatchdogState(missionId: string, kind: WatchdogKind) {
      deleteWatchdogStateRow(db, missionId, kind)
    },
  }
}

export function attachDeliveryDb(db: Database) {
  return {
    getDeliveryDocument(missionId: string) {
      return readDeliveryDocumentFromDb(db, missionId)
    },
    saveDeliveryDocument(doc: DeliveryDocument) {
      writeDeliveryDocumentToDb(db, doc)
    },
  }
}

export type ManifestDbFacade = ReturnType<typeof attachManifestDb>
export type MissionRegistryDbFacade = ReturnType<typeof attachMissionRegistryDb>
export type OrchestrationDbFacade = ReturnType<typeof attachOrchestrationDb>
export type MissionArtifactsDbFacade = ReturnType<typeof attachMissionArtifactsDb>
export type WatchdogDbFacade = ReturnType<typeof attachWatchdogDb>
export type DeliveryDbFacade = ReturnType<typeof attachDeliveryDb>

export type RegistryDatabaseFacade = ManifestDbFacade &
  MissionRegistryDbFacade &
  OrchestrationDbFacade &
  MissionArtifactsDbFacade &
  WatchdogDbFacade &
  DeliveryDbFacade
