import { mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { gatehouseRoot } from "../paths.ts"
import type { RetroManifest, TreeManifest } from "../tree/types.ts"
import {
  REGISTRY_SCHEMA_VERSION,
  type RegistryAgent,
  type RegistryMissionRecord,
  type RegistryPendingDelivery,
  type RegistryRetroCompletion,
  type RegistryRetroRun,
  type RegistrySkillExtractCompletion,
  type RegistrySkillExtractRun,
  type RegistrySnapshot,
} from "./types.ts"
import {
  findTreeManifestByExecSession,
  findTreeManifestByRetroSession,
  getRetroManifest,
  getTreeManifest,
  listTreeMissionIds,
  listTreesIndex,
  migrateTreeManifestDisplayName,
  migrateTreeManifestProfileColumn,
  migrateTreeManifestDescriptionColumn,
  saveRetroManifest,
  saveTreeManifest,
  TREE_MANIFEST_SCHEMA_SQL,
} from "./tree-manifest-db.ts"
import {
  migrateMissionArtifactsTables,
  readMissionContractRaw,
  readNodeBrief,
  saveMissionContractRaw,
  saveNodeBrief,
  listNodeBriefIds,
} from "./mission-artifacts-db.ts"
import {
  migrateOrchestrationTables,
  readMissionScript,
  readOrchestrationState,
  saveMissionScript as persistMissionScript,
  saveOrchestrationState as persistOrchestrationState,
} from "./orchestration-db.ts"
import type { OrchestrationState } from "../orchestration/types.ts"
import type { MissionScriptMeta } from "../orchestration/types.ts"
import type { TeamSpec } from "../tree/types.ts"
import {
  deleteWatchdogState as deleteWatchdogStateRow,
  loadAllWatchdogStates,
  migrateWatchdogStateTable,
  saveWatchdogState as saveWatchdogStateRow,
  WATCHDOG_STATE_TABLE_SQL,
} from "../watchdog/state-db.ts"
import type { WatchdogKind } from "../watchdog/state-db.ts"
import type { MissionWatchState } from "../watchdog/signals.ts"
import {
  readDeliveryDocumentFromDb,
  writeDeliveryDocumentToDb,
} from "../delivery/db.ts"
import type { DeliveryDocument } from "../delivery/types.ts"

type AgentRow = {
  agent_id: string
  scope: string
  profile: string
  session_id: string
  display_name: string
  mission_id: string | null
  node_id: string | null
  parent_session_id: string | null
  project_root_session_id: string | null
  status: string
  created_at: string
  updated_at: string
}

type DeliveryRow = {
  id: string
  recipient_session_id: string
  recipient_agent_id: string
  sender_agent_id: string | null
  prompt_text: string
  prompt_profile: string | null
  created_at: string
  attempts: number | null
  last_attempt_at: string | null
  last_error: string | null
  next_retry_at: string | null
}

function rowToAgent(row: AgentRow): RegistryAgent {
  return {
    agentId: row.agent_id,
    scope: row.scope as RegistryAgent["scope"],
    profile: row.profile,
    sessionId: row.session_id,
    displayName: row.display_name,
    status: row.status as RegistryAgent["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.mission_id && { missionId: row.mission_id }),
    ...(row.node_id && { nodeId: row.node_id }),
    ...(row.parent_session_id && { parentSessionId: row.parent_session_id }),
    ...(row.project_root_session_id && { projectRootSessionId: row.project_root_session_id }),
  }
}

function rowToDelivery(row: DeliveryRow): RegistryPendingDelivery {
  return {
    id: row.id,
    recipientSessionId: row.recipient_session_id,
    recipientAgentId: row.recipient_agent_id,
    promptText: row.prompt_text,
    createdAt: row.created_at,
    ...(row.sender_agent_id && { senderAgentId: row.sender_agent_id }),
    ...(row.prompt_profile && { promptProfile: row.prompt_profile }),
    ...(row.attempts != null && { attempts: row.attempts }),
    ...(row.last_attempt_at && { lastAttemptAt: row.last_attempt_at }),
    ...(row.last_error && { lastError: row.last_error }),
    ...(row.next_retry_at && { nextRetryAt: row.next_retry_at }),
  }
}

function configureSqlite(db: Database) {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
}

function schemaReady(db: Database) {
  const row = db.query("PRAGMA user_version").get() as { user_version: number } | undefined
  return row?.user_version === REGISTRY_SCHEMA_VERSION
}

function tableColumns(db: Database, table: string) {
  const exists = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name")
    .get({ $name: table })
  if (!exists) return new Set<string>()
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(columns.map((column) => column.name))
}

export function migrateRetroRollupLeadNotifiedColumns(db: Database) {
  const retroCols = tableColumns(db, "registry_retro_run")
  if (retroCols.size > 0 && !retroCols.has("architect_lead_notified_at")) {
    db.exec("ALTER TABLE registry_retro_run ADD COLUMN architect_lead_notified_at TEXT")
  }
  const skillCols = tableColumns(db, "registry_skill_extract_run")
  if (skillCols.size > 0 && !skillCols.has("curator_lead_notified_at")) {
    db.exec("ALTER TABLE registry_skill_extract_run ADD COLUMN curator_lead_notified_at TEXT")
  }
}

export function migrateRegistryProfileOnly(db: Database) {
  const version = (db.query("PRAGMA user_version").get() as { user_version: number } | undefined)?.user_version ?? 0
  if (version >= REGISTRY_SCHEMA_VERSION) return

  const agentCols = tableColumns(db, "registry_agent")
  if (agentCols.has("opencode_agent")) {
    db.exec(`
      UPDATE registry_agent
      SET profile = opencode_agent
      WHERE scope IN ('inner', 'retro')
         OR (node_id IS NOT NULL AND profile = node_id)
    `)
    db.exec("ALTER TABLE registry_agent DROP COLUMN opencode_agent")
  }

  const deliveryCols = tableColumns(db, "registry_pending_delivery")
  if (deliveryCols.has("opencode_agent") && !deliveryCols.has("prompt_profile")) {
    db.exec("ALTER TABLE registry_pending_delivery RENAME COLUMN opencode_agent TO prompt_profile")
  }
}

function applySchema(db: Database) {
  configureSqlite(db)
  migrateTreeManifestDisplayName(db)
  migrateTreeManifestProfileColumn(db)
  migrateTreeManifestDescriptionColumn(db)
  migrateRegistryProfileOnly(db)
  migrateRetroRollupLeadNotifiedColumns(db)
  migrateWatchdogStateTable(db)
  migrateMissionArtifactsTables(db)
  migrateOrchestrationTables(db)
  if (schemaReady(db)) return
  db.exec(`
    PRAGMA user_version = ${REGISTRY_SCHEMA_VERSION};

    CREATE TABLE IF NOT EXISTS registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      profile TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      parent_session_id TEXT,
      project_root_session_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registry_agent_session_idx ON registry_agent(session_id);
    CREATE INDEX IF NOT EXISTS registry_agent_scope_profile_idx ON registry_agent(scope, profile);
    CREATE INDEX IF NOT EXISTS registry_agent_mission_idx ON registry_agent(mission_id);

    CREATE TABLE IF NOT EXISTS registry_pending_delivery (
      id TEXT PRIMARY KEY,
      recipient_session_id TEXT NOT NULL,
      recipient_agent_id TEXT NOT NULL,
      sender_agent_id TEXT,
      prompt_text TEXT NOT NULL,
      prompt_profile TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER,
      last_attempt_at TEXT,
      last_error TEXT,
      next_retry_at TEXT
    );
    CREATE INDEX IF NOT EXISTS registry_pending_recipient_idx ON registry_pending_delivery(recipient_session_id);

    CREATE TABLE IF NOT EXISTS registry_retro_run (
      mission_id TEXT PRIMARY KEY,
      expected_node_ids TEXT NOT NULL,
      started_at TEXT NOT NULL,
      architect_notified_at TEXT,
      architect_lead_notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registry_retro_completion (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      report_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS registry_skill_extract_run (
      mission_id TEXT PRIMARY KEY,
      expected_node_ids TEXT NOT NULL,
      started_at TEXT NOT NULL,
      curator_notified_at TEXT,
      curator_lead_notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registry_skill_extract_completion (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      summary_path TEXT,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS registry_mission (
      mission_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      priority TEXT,
      objective TEXT,
      done_when_json TEXT NOT NULL,
      must_not_json TEXT NOT NULL,
      contract_raw_json TEXT,
      notes TEXT,
      user_topology TEXT,
      user_skill TEXT,
      started_at TEXT,
      completed_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS registry_mission_active_idx ON registry_mission(is_active) WHERE is_active = 1;

    ${WATCHDOG_STATE_TABLE_SQL}

    ${TREE_MANIFEST_SCHEMA_SQL}
  `)
  migrateMissionArtifactsTables(db)
}

type MissionRow = {
  mission_id: string
  status: string
  priority: string | null
  objective: string | null
  done_when_json: string
  must_not_json: string
  contract_raw_json: string | null
  notes: string | null
  user_topology: string | null
  user_skill: string | null
  started_at: string | null
  completed_at: string | null
  is_active: number
  locked_at: string
  updated_at: string
}

function rowToMission(row: MissionRow): RegistryMissionRecord {
  return {
    missionId: row.mission_id,
    status: row.status,
    doneWhen: JSON.parse(row.done_when_json) as string[],
    mustNot: JSON.parse(row.must_not_json) as string[],
    isActive: row.is_active === 1,
    lockedAt: row.locked_at,
    updatedAt: row.updated_at,
    ...(row.priority && { priority: row.priority }),
    ...(row.objective && { objective: row.objective }),
    ...(row.notes && { notes: row.notes }),
    ...(row.user_topology && { userTopology: row.user_topology }),
    ...(row.user_skill && { userSkill: row.user_skill }),
    ...(row.started_at && { startedAt: row.started_at }),
    ...(row.completed_at && { completedAt: row.completed_at }),
    ...(row.contract_raw_json && { contractRawJson: JSON.parse(row.contract_raw_json) as unknown }),
  }
}

export class RegistryDatabase {
  readonly path: string
  private db: Database

  constructor(projectDirectory: string, options?: { readonly?: boolean }) {
    const dir = gatehouseRoot(projectDirectory)
    mkdirSync(dir, { recursive: true })
    this.path = path.join(dir, "registry.db")
    this.db = options?.readonly ? new Database(this.path, { readonly: true }) : new Database(this.path)
    if (options?.readonly) configureSqlite(this.db)
    else applySchema(this.db)
  }

  load(): RegistrySnapshot {
    const agents = this.db
      .query("SELECT * FROM registry_agent ORDER BY updated_at, agent_id")
      .all()
      .map((row) => rowToAgent(row as AgentRow))
    const pendingDeliveries = this.db
      .query("SELECT * FROM registry_pending_delivery ORDER BY created_at, id")
      .all()
      .map((row) => rowToDelivery(row as DeliveryRow))
    const retroRuns = this.db
      .query("SELECT * FROM registry_retro_run ORDER BY started_at, mission_id")
      .all()
      .map((row) => {
        const record = row as {
          mission_id: string
          expected_node_ids: string
          started_at: string
          architect_notified_at: string | null
          architect_lead_notified_at: string | null
        }
        const expectedNodeIds = JSON.parse(record.expected_node_ids) as string[]
        return {
          missionId: record.mission_id,
          expectedNodeIds,
          startedAt: record.started_at,
          ...(record.architect_notified_at && { architectNotifiedAt: record.architect_notified_at }),
          ...(record.architect_lead_notified_at && { architectLeadNotifiedAt: record.architect_lead_notified_at }),
        } satisfies RegistryRetroRun
      })
    const retroCompletions = this.db
      .query("SELECT * FROM registry_retro_completion ORDER BY completed_at, mission_id, node_id")
      .all()
      .map((row) => {
        const record = row as {
          mission_id: string
          node_id: string
          report_path: string
          session_id: string
          completed_at: string
        }
        return {
          missionId: record.mission_id,
          nodeId: record.node_id,
          reportPath: record.report_path,
          sessionId: record.session_id,
          completedAt: record.completed_at,
        } satisfies RegistryRetroCompletion
      })
    const skillExtractRuns = this.db
      .query("SELECT * FROM registry_skill_extract_run ORDER BY started_at, mission_id")
      .all()
      .map((row) => {
        const record = row as {
          mission_id: string
          expected_node_ids: string
          started_at: string
          curator_notified_at: string | null
          curator_lead_notified_at: string | null
        }
        return {
          missionId: record.mission_id,
          expectedNodeIds: JSON.parse(record.expected_node_ids) as string[],
          startedAt: record.started_at,
          ...(record.curator_notified_at && { curatorNotifiedAt: record.curator_notified_at }),
          ...(record.curator_lead_notified_at && { curatorLeadNotifiedAt: record.curator_lead_notified_at }),
        } satisfies RegistrySkillExtractRun
      })
    const skillExtractCompletions = this.db
      .query("SELECT * FROM registry_skill_extract_completion ORDER BY completed_at, mission_id, node_id")
      .all()
      .map((row) => {
        const record = row as {
          mission_id: string
          node_id: string
          summary_path: string | null
          session_id: string
          completed_at: string
        }
        return {
          missionId: record.mission_id,
          nodeId: record.node_id,
          sessionId: record.session_id,
          completedAt: record.completed_at,
          ...(record.summary_path && { summaryPath: record.summary_path }),
        } satisfies RegistrySkillExtractCompletion
      })
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      agents,
      pendingDeliveries,
      retroRuns,
      retroCompletions,
      skillExtractRuns,
      skillExtractCompletions,
    }
  }

  save(snapshot: RegistrySnapshot) {
    this.db.exec("BEGIN")
    try {
      this.db.exec("DELETE FROM registry_agent")
      this.db.exec("DELETE FROM registry_pending_delivery")
      this.db.exec("DELETE FROM registry_retro_run")
      this.db.exec("DELETE FROM registry_retro_completion")
      this.db.exec("DELETE FROM registry_skill_extract_run")
      this.db.exec("DELETE FROM registry_skill_extract_completion")
      const insertAgent = this.db.prepare(`
        INSERT INTO registry_agent (
          agent_id, scope, profile, session_id, display_name,
          mission_id, node_id, parent_session_id, project_root_session_id,
          status, created_at, updated_at
        ) VALUES (
          $agent_id, $scope, $profile, $session_id, $display_name,
          $mission_id, $node_id, $parent_session_id, $project_root_session_id,
          $status, $created_at, $updated_at
        )
      `)
      for (const agent of snapshot.agents) {
        insertAgent.run({
          $agent_id: agent.agentId,
          $scope: agent.scope,
          $profile: agent.profile,
          $session_id: agent.sessionId,
          $display_name: agent.displayName,
          $mission_id: agent.missionId ?? null,
          $node_id: agent.nodeId ?? null,
          $parent_session_id: agent.parentSessionId ?? null,
          $project_root_session_id: agent.projectRootSessionId ?? null,
          $status: agent.status,
          $created_at: agent.createdAt,
          $updated_at: agent.updatedAt,
        })
      }
      const insertDelivery = this.db.prepare(`
        INSERT INTO registry_pending_delivery (
          id, recipient_session_id, recipient_agent_id, sender_agent_id, prompt_text,
          prompt_profile, created_at, attempts, last_attempt_at, last_error, next_retry_at
        ) VALUES (
          $id, $recipient_session_id, $recipient_agent_id, $sender_agent_id, $prompt_text,
          $prompt_profile, $created_at, $attempts, $last_attempt_at, $last_error, $next_retry_at
        )
      `)
      for (const delivery of snapshot.pendingDeliveries) {
        insertDelivery.run({
          $id: delivery.id,
          $recipient_session_id: delivery.recipientSessionId,
          $recipient_agent_id: delivery.recipientAgentId,
          $sender_agent_id: delivery.senderAgentId ?? null,
          $prompt_text: delivery.promptText,
          $prompt_profile: delivery.promptProfile ?? null,
          $created_at: delivery.createdAt,
          $attempts: delivery.attempts ?? null,
          $last_attempt_at: delivery.lastAttemptAt ?? null,
          $last_error: delivery.lastError ?? null,
          $next_retry_at: delivery.nextRetryAt ?? null,
        })
      }
      const insertRetroRun = this.db.prepare(`
        INSERT INTO registry_retro_run (
          mission_id, expected_node_ids, started_at, architect_notified_at, architect_lead_notified_at
        ) VALUES ($mission_id, $expected_node_ids, $started_at, $architect_notified_at, $architect_lead_notified_at)
      `)
      for (const run of snapshot.retroRuns) {
        insertRetroRun.run({
          $mission_id: run.missionId,
          $expected_node_ids: JSON.stringify(run.expectedNodeIds),
          $started_at: run.startedAt,
          $architect_notified_at: run.architectNotifiedAt ?? null,
          $architect_lead_notified_at: run.architectLeadNotifiedAt ?? null,
        })
      }
      const insertRetroCompletion = this.db.prepare(`
        INSERT INTO registry_retro_completion (
          mission_id, node_id, report_path, session_id, completed_at
        ) VALUES ($mission_id, $node_id, $report_path, $session_id, $completed_at)
      `)
      for (const item of snapshot.retroCompletions) {
        insertRetroCompletion.run({
          $mission_id: item.missionId,
          $node_id: item.nodeId,
          $report_path: item.reportPath,
          $session_id: item.sessionId,
          $completed_at: item.completedAt,
        })
      }
      const insertSkillExtractRun = this.db.prepare(`
        INSERT INTO registry_skill_extract_run (
          mission_id, expected_node_ids, started_at, curator_notified_at, curator_lead_notified_at
        ) VALUES ($mission_id, $expected_node_ids, $started_at, $curator_notified_at, $curator_lead_notified_at)
      `)
      for (const run of snapshot.skillExtractRuns) {
        insertSkillExtractRun.run({
          $mission_id: run.missionId,
          $expected_node_ids: JSON.stringify(run.expectedNodeIds),
          $started_at: run.startedAt,
          $curator_notified_at: run.curatorNotifiedAt ?? null,
          $curator_lead_notified_at: run.curatorLeadNotifiedAt ?? null,
        })
      }
      const insertSkillExtractCompletion = this.db.prepare(`
        INSERT INTO registry_skill_extract_completion (
          mission_id, node_id, summary_path, session_id, completed_at
        ) VALUES ($mission_id, $node_id, $summary_path, $session_id, $completed_at)
      `)
      for (const item of snapshot.skillExtractCompletions) {
        insertSkillExtractCompletion.run({
          $mission_id: item.missionId,
          $node_id: item.nodeId,
          $summary_path: item.summaryPath ?? null,
          $session_id: item.sessionId,
          $completed_at: item.completedAt,
        })
      }
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  getActiveMission() {
    const row = this.db
      .query("SELECT * FROM registry_mission WHERE is_active = 1 LIMIT 1")
      .get() as MissionRow | undefined
    return row ? rowToMission(row) : undefined
  }

  getMission(missionId: string) {
    const row = this.db
      .query("SELECT * FROM registry_mission WHERE mission_id = $mission_id")
      .get({ $mission_id: missionId }) as MissionRow | undefined
    return row ? rowToMission(row) : undefined
  }

  activateMission(record: RegistryMissionRecord) {
    this.db.exec("BEGIN")
    try {
      this.db.run("UPDATE registry_mission SET is_active = 0 WHERE is_active = 1")
      const upsert = this.db.prepare(
        `INSERT INTO registry_mission (
          mission_id, status, priority, objective, done_when_json, must_not_json, contract_raw_json, notes,
          user_topology, user_skill, started_at, completed_at, is_active, locked_at, updated_at
        ) VALUES (
          $mission_id, $status, $priority, $objective, $done_when_json, $must_not_json, $contract_raw_json, $notes,
          $user_topology, $user_skill, $started_at, $completed_at, 1, $locked_at, $updated_at
        )
        ON CONFLICT(mission_id) DO UPDATE SET
          status = excluded.status,
          priority = excluded.priority,
          objective = excluded.objective,
          done_when_json = excluded.done_when_json,
          must_not_json = excluded.must_not_json,
          contract_raw_json = COALESCE(excluded.contract_raw_json, registry_mission.contract_raw_json),
          notes = excluded.notes,
          user_topology = excluded.user_topology,
          user_skill = excluded.user_skill,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          is_active = 1,
          locked_at = excluded.locked_at,
          updated_at = excluded.updated_at`,
      )
      upsert.run({
        $mission_id: record.missionId,
        $status: record.status,
        $priority: record.priority ?? null,
        $objective: record.objective ?? null,
        $done_when_json: JSON.stringify(record.doneWhen),
        $must_not_json: JSON.stringify(record.mustNot),
        $contract_raw_json:
          record.contractRawJson !== undefined ? JSON.stringify(record.contractRawJson) : null,
        $notes: record.notes ?? null,
        $user_topology: record.userTopology ?? null,
        $user_skill: record.userSkill ?? null,
        $started_at: record.startedAt ?? null,
        $completed_at: record.completedAt ?? null,
        $locked_at: record.lockedAt,
        $updated_at: record.updatedAt,
      })
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  updateMissionStatus(missionId: string, status: string, completedAt?: string) {
    const updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE registry_mission SET status = $status, updated_at = $updated_at,
        completed_at = COALESCE($completed_at, completed_at)
       WHERE mission_id = $mission_id`,
      )
      .run({
        $mission_id: missionId,
        $status: status,
        $updated_at: updatedAt,
        $completed_at: completedAt ?? null,
      })
  }

  deactivateMission(missionId: string) {
    this.db
      .prepare(
        "UPDATE registry_mission SET is_active = 0, updated_at = $updated_at WHERE mission_id = $mission_id",
      )
      .run({ $mission_id: missionId, $updated_at: new Date().toISOString() })
  }

  getTreeManifest(missionId: string) {
    return getTreeManifest(this.db, missionId)
  }

  saveTreeManifest(manifest: TreeManifest) {
    return saveTreeManifest(this.db, manifest)
  }

  listTreeMissionIds(status?: TreeManifest["status"]) {
    return listTreeMissionIds(this.db, status)
  }

  listTreesIndex() {
    return listTreesIndex(this.db)
  }

  findTreeManifestByExecSession(sessionId: string) {
    return findTreeManifestByExecSession(this.db, sessionId)
  }

  getRetroManifest(missionId: string) {
    return getRetroManifest(this.db, missionId)
  }

  saveRetroManifest(retro: RetroManifest) {
    return saveRetroManifest(this.db, retro)
  }

  findTreeManifestByRetroSession(sessionId: string) {
    return findTreeManifestByRetroSession(this.db, sessionId)
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
    team: TeamSpec
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

  getDeliveryDocument(missionId: string) {
    return readDeliveryDocumentFromDb(this.db, missionId)
  }

  saveDeliveryDocument(doc: DeliveryDocument) {
    writeDeliveryDocumentToDb(this.db, doc)
  }
}
