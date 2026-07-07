import type { Database } from "bun:sqlite"
import { migrateWatchdogStateTable, WATCHDOG_STATE_TABLE_SQL } from "../watchdog/state-db.ts"
import { migrateMissionArtifactsTables } from "./mission-artifacts-db.ts"
import { MISSION_MANIFEST_SCHEMA_SQL } from "./mission-manifest-db.ts"
import { migrateOrchestrationTables } from "./orchestration-db.ts"
import { AGENTS_SCHEMA_SQL, migrateAgentsProfileColumns } from "./agents-db.ts"
import { MISSIONS_SCHEMA_SQL } from "./missions-db.ts"
import {
  migrateRetroAnalystSchema,
  migrateRetroLeadNotifiedColumns,
  migrateSkillPipelineTables,
  SKILL_PIPELINE_SCHEMA_SQL,
} from "./skill-pipeline-db.ts"
import { configureSqlite, schemaReady } from "./sqlite.ts"
import { REGISTRY_SCHEMA_VERSION } from "./types.ts"

export function applyRegistrySchema(db: Database) {
  configureSqlite(db)
  migrateAgentsProfileColumns(db)
  migrateRetroAnalystSchema(db)
  migrateRetroLeadNotifiedColumns(db)
  migrateSkillPipelineTables(db)
  migrateWatchdogStateTable(db)
  migrateMissionArtifactsTables(db)
  migrateOrchestrationTables(db)
  if (schemaReady(db)) return
  db.exec(`
    PRAGMA user_version = ${REGISTRY_SCHEMA_VERSION};

    ${AGENTS_SCHEMA_SQL}

    ${SKILL_PIPELINE_SCHEMA_SQL}

    ${MISSIONS_SCHEMA_SQL}

    ${WATCHDOG_STATE_TABLE_SQL}

    ${MISSION_MANIFEST_SCHEMA_SQL}
  `)
  migrateMissionArtifactsTables(db)
}
