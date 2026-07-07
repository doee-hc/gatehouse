import { mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { gatehouseRoot } from "../paths.ts"
import {
  REGISTRY_SCHEMA_VERSION,
  type RegistrySnapshot,
} from "./types.ts"
import { readAgents, readPendingDeliveries, writeAgentsAndDeliveries } from "./agents-db.ts"
import { readSkillPipelineSnapshot, writeSkillPipelineSnapshot } from "./skill-pipeline-db.ts"
import { applyRegistrySchema } from "./registry-schema.ts"
import { configureSqlite } from "./sqlite.ts"
import {
  attachDeliveryDb,
  attachManifestDb,
  attachMissionArtifactsDb,
  attachMissionRegistryDb,
  attachOrchestrationDb,
  attachWatchdogDb,
  type RegistryDatabaseFacade,
} from "./db-facades.ts"

export class RegistryDatabase implements RegistryDatabaseFacade {
  readonly path: string
  private db: Database

  constructor(projectDirectory: string, options?: { readonly?: boolean }) {
    const dir = gatehouseRoot(projectDirectory)
    mkdirSync(dir, { recursive: true })
    this.path = path.join(dir, "registry.db")
    this.db = options?.readonly ? new Database(this.path, { readonly: true }) : new Database(this.path)
    if (options?.readonly) configureSqlite(this.db)
    else applyRegistrySchema(this.db)
    Object.assign(
      this,
      attachManifestDb(this.db),
      attachMissionRegistryDb(this.db),
      attachOrchestrationDb(this.db),
      attachMissionArtifactsDb(this.db),
      attachWatchdogDb(this.db),
      attachDeliveryDb(this.db),
    )
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

  declare getMissionManifest: RegistryDatabaseFacade["getMissionManifest"]
  declare saveMissionManifest: RegistryDatabaseFacade["saveMissionManifest"]
  declare listMissionIds: RegistryDatabaseFacade["listMissionIds"]
  declare listMissionManifestIndex: RegistryDatabaseFacade["listMissionManifestIndex"]
  declare findMissionManifestByExecSession: RegistryDatabaseFacade["findMissionManifestByExecSession"]
  declare getRetroManifest: RegistryDatabaseFacade["getRetroManifest"]
  declare saveRetroManifest: RegistryDatabaseFacade["saveRetroManifest"]
  declare getExtractManifest: RegistryDatabaseFacade["getExtractManifest"]
  declare saveExtractManifest: RegistryDatabaseFacade["saveExtractManifest"]
  declare getVerifyManifest: RegistryDatabaseFacade["getVerifyManifest"]
  declare saveVerifyManifest: RegistryDatabaseFacade["saveVerifyManifest"]
  declare findMissionManifestByRetroSession: RegistryDatabaseFacade["findMissionManifestByRetroSession"]
  declare findMissionManifestByExtractSession: RegistryDatabaseFacade["findMissionManifestByExtractSession"]
  declare findMissionManifestByVerifySession: RegistryDatabaseFacade["findMissionManifestByVerifySession"]
  declare getActiveMission: RegistryDatabaseFacade["getActiveMission"]
  declare getMission: RegistryDatabaseFacade["getMission"]
  declare activateMission: RegistryDatabaseFacade["activateMission"]
  declare updateMissionStatus: RegistryDatabaseFacade["updateMissionStatus"]
  declare deactivateMission: RegistryDatabaseFacade["deactivateMission"]
  declare saveMissionScript: RegistryDatabaseFacade["saveMissionScript"]
  declare getMissionScript: RegistryDatabaseFacade["getMissionScript"]
  declare saveOrchestrationState: RegistryDatabaseFacade["saveOrchestrationState"]
  declare getOrchestrationState: RegistryDatabaseFacade["getOrchestrationState"]
  declare mutateOrchestrationState: RegistryDatabaseFacade["mutateOrchestrationState"]
  declare saveOrchestrationPlan: RegistryDatabaseFacade["saveOrchestrationPlan"]
  declare getOrchestrationPlan: RegistryDatabaseFacade["getOrchestrationPlan"]
  declare getLatestOrchestrationPlan: RegistryDatabaseFacade["getLatestOrchestrationPlan"]
  declare saveOrchestrationBaseline: RegistryDatabaseFacade["saveOrchestrationBaseline"]
  declare getOrchestrationBaseline: RegistryDatabaseFacade["getOrchestrationBaseline"]
  declare saveMissionContractRaw: RegistryDatabaseFacade["saveMissionContractRaw"]
  declare getMissionContractRaw: RegistryDatabaseFacade["getMissionContractRaw"]
  declare saveNodeBrief: RegistryDatabaseFacade["saveNodeBrief"]
  declare getNodeBrief: RegistryDatabaseFacade["getNodeBrief"]
  declare listNodeBriefIds: RegistryDatabaseFacade["listNodeBriefIds"]
  declare loadWatchdogStates: RegistryDatabaseFacade["loadWatchdogStates"]
  declare saveWatchdogState: RegistryDatabaseFacade["saveWatchdogState"]
  declare deleteWatchdogState: RegistryDatabaseFacade["deleteWatchdogState"]
  declare getDeliveryDocument: RegistryDatabaseFacade["getDeliveryDocument"]
  declare saveDeliveryDocument: RegistryDatabaseFacade["saveDeliveryDocument"]
}
