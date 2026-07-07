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
import { mixinRegistryDatabaseFacade, type RegistryDatabaseFacade } from "./db-facades.ts"

export interface RegistryDatabase extends RegistryDatabaseFacade {
  path: string
  load(): RegistrySnapshot
  save(snapshot: RegistrySnapshot): void
}

export class RegistryDatabase {
  path: string
  private db: Database

  constructor(projectDirectory: string, options?: { readonly?: boolean }) {
    const dir = gatehouseRoot(projectDirectory)
    mkdirSync(dir, { recursive: true })
    this.path = path.join(dir, "registry.db")
    this.db = options?.readonly ? new Database(this.path, { readonly: true }) : new Database(this.path)
    if (options?.readonly) configureSqlite(this.db)
    else applyRegistrySchema(this.db)
    Object.assign(this, mixinRegistryDatabaseFacade(this.db))
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
}
