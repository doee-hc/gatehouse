import { mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { gatehouseRoot } from "../paths.ts"
import type { MissionRetroManifest, MissionManifest } from "../missions/manifest/types.ts"
import {
  REGISTRY_SCHEMA_VERSION,
  type RegistryMissionRecord,
  type RegistrySnapshot,
} from "./types.ts"
import {
  findMissionManifestByExecSession,
  findMissionManifestByRetroSession,
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
import type { OrchestrationState } from "../orchestration/types.ts"
import type { MissionScriptMeta } from "../orchestration/types.ts"
import type { MissionTeamSpec } from "../missions/manifest/types.ts"
import {
  deleteWatchdogState as deleteWatchdogStateRow,
  loadAllWatchdogStates,
  saveWatchdogState as saveWatchdogStateRow,
} from "../watchdog/state-db.ts"
import type { WatchdogKind } from "../watchdog/state-db.ts"
import type { MissionWatchState } from "../watchdog/signals.ts"
import {
  readDeliveryDocumentFromDb,
  writeDeliveryDocumentToDb,
} from "../delivery/db.ts"
import type { DeliveryDocument } from "../delivery/types.ts"
import { readAgents, readPendingDeliveries, writeAgentsAndDeliveries } from "./agents-db.ts"
import {
  activateMission as persistActivateMission,
  deactivateMission as persistDeactivateMission,
  getActiveMission as readActiveMission,
  getMission as readMission,
  updateMissionStatus as persistUpdateMissionStatus,
} from "./missions-db.ts"
import { readSkillPipelineSnapshot, writeSkillPipelineSnapshot } from "./skill-pipeline-db.ts"
import { applyRegistrySchema } from "./registry-schema.ts"
import { configureSqlite } from "./sqlite.ts"

export class RegistryDatabase {
  readonly path: string
  private db: Database

  constructor(projectDirectory: string, options?: { readonly?: boolean }) {
    const dir = gatehouseRoot(projectDirectory)
    mkdirSync(dir, { recursive: true })
    this.path = path.join(dir, "registry.db")
    this.db = options?.readonly ? new Database(this.path, { readonly: true }) : new Database(this.path)
    if (options?.readonly) configureSqlite(this.db)
    else applyRegistrySchema(this.db)
  }

  load(): RegistrySnapshot {
    const agents = readAgents(this.db)
    const pendingDeliveries = readPendingDeliveries(this.db)
    const pipeline = readSkillPipelineSnapshot(this.db)
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      agents,
      pendingDeliveries,
      ...pipeline,
    }
  }

  save(snapshot: RegistrySnapshot) {
    this.db.exec("BEGIN")
    try {
      writeAgentsAndDeliveries(this.db, snapshot.agents, snapshot.pendingDeliveries)
      writeSkillPipelineSnapshot(this.db, snapshot)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  getActiveMission() {
    return readActiveMission(this.db)
  }

  getMission(missionId: string) {
    return readMission(this.db, missionId)
  }

  activateMission(record: RegistryMissionRecord) {
    persistActivateMission(this.db, record)
  }

  updateMissionStatus(missionId: string, status: string, completedAt?: string) {
    persistUpdateMissionStatus(this.db, missionId, status, completedAt)
  }

  deactivateMission(missionId: string) {
    persistDeactivateMission(this.db, missionId)
  }

  getMissionManifest(missionId: string) {
    return getMissionManifest(this.db, missionId)
  }

  saveMissionManifest(manifest: MissionManifest) {
    return saveMissionManifest(this.db, manifest)
  }

  listMissionIds(status?: MissionManifest["status"]) {
    return listMissionIds(this.db, status)
  }

  listMissionManifestIndex() {
    return listMissionManifestIndex(this.db)
  }

  findMissionManifestByExecSession(sessionId: string) {
    return findMissionManifestByExecSession(this.db, sessionId)
  }

  getRetroManifest(missionId: string) {
    return getRetroManifest(this.db, missionId)
  }

  saveRetroManifest(retro: MissionRetroManifest) {
    return saveRetroManifest(this.db, retro)
  }

  getExtractManifest(missionId: string) {
    return getExtractManifest(this.db, missionId)
  }

  saveExtractManifest(extract: import("../missions/manifest/types.ts").MissionExtractManifest) {
    return saveExtractManifest(this.db, extract)
  }

  getVerifyManifest(missionId: string) {
    return getVerifyManifest(this.db, missionId)
  }

  saveVerifyManifest(verify: import("../missions/manifest/types.ts").MissionVerifyManifest) {
    return saveVerifyManifest(this.db, verify)
  }

  findMissionManifestByRetroSession(sessionId: string) {
    return findMissionManifestByRetroSession(this.db, sessionId)
  }

  loadWatchdogStates() {
    return loadAllWatchdogStates(this.db)
  }

  saveWatchdogState(missionId: string, kind: WatchdogKind, state: MissionWatchState) {
    saveWatchdogStateRow(this.db, missionId, kind, state)
  }

  deleteWatchdogState(missionId: string, kind: WatchdogKind) {
    deleteWatchdogStateRow(this.db, missionId, kind)
  }

  saveMissionContractRaw(missionId: string, contractRaw: unknown) {
    saveMissionContractRaw(this.db, missionId, contractRaw)
  }

  getMissionContractRaw(missionId: string) {
    return readMissionContractRaw(this.db, missionId)
  }

  saveNodeBrief(missionId: string, nodeId: string, brief: import("../execution/types.ts").NodeBrief) {
    saveNodeBrief(this.db, missionId, nodeId, brief)
  }

  getNodeBrief(missionId: string, nodeId: string) {
    return readNodeBrief(this.db, missionId, nodeId)
  }

  listNodeBriefIds(missionId: string) {
    return listNodeBriefIds(this.db, missionId)
  }

  saveMissionScript(input: {
    missionId: string
    team: MissionTeamSpec
    meta?: MissionScriptMeta
    scriptPath?: string
    scriptHash?: string
  }) {
    persistMissionScript(this.db, input)
  }

  getMissionScript(missionId: string) {
    return readMissionScript(this.db, missionId)
  }

  saveOrchestrationState(state: OrchestrationState) {
    persistOrchestrationState(this.db, state)
  }

  getOrchestrationState(missionId: string) {
    return readOrchestrationState(this.db, missionId)
  }

  mutateOrchestrationState(missionId: string, mutator: (state: OrchestrationState) => void) {
    return persistMutateOrchestrationState(this.db, missionId, mutator)
  }

  saveOrchestrationPlan(plan: import("../orchestration/plan/types.ts").OrchestrationPlan) {
    persistOrchestrationPlan(this.db, plan)
  }

  getOrchestrationPlan(missionId: string, planVersion: string) {
    return readOrchestrationPlan(this.db, missionId, planVersion)
  }

  getLatestOrchestrationPlan(missionId: string) {
    return readLatestOrchestrationPlan(this.db, missionId)
  }

  saveOrchestrationBaseline(baseline: import("../orchestration/plan/types.ts").OrchestrationBaseline) {
    persistOrchestrationBaseline(this.db, baseline)
  }

  getOrchestrationBaseline(baselineId: string) {
    return readOrchestrationBaseline(this.db, baselineId)
  }

  getDeliveryDocument(missionId: string) {
    return readDeliveryDocumentFromDb(this.db, missionId)
  }

  saveDeliveryDocument(doc: DeliveryDocument) {
    writeDeliveryDocumentToDb(this.db, doc)
  }
}
