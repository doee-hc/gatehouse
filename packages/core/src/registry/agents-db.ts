import type { Database } from "bun:sqlite"
import { REGISTRY_SCHEMA_VERSION } from "./types.ts"
import type { RegistryAgent, RegistryPendingDelivery } from "./types.ts"
import { tableColumns } from "./sqlite.ts"

export const AGENTS_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS registry_agent (
      agent_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      profile TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mission_id TEXT,
      node_id TEXT,
      parent_session_id TEXT,
      project_terminal_session_id TEXT,
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
`

type AgentRow = {
  agent_id: string
  scope: string
  profile: string
  session_id: string
  display_name: string
  mission_id: string | null
  node_id: string | null
  parent_session_id: string | null
  project_terminal_session_id: string | null
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
    ...(row.project_terminal_session_id && { projectRootSessionId: row.project_terminal_session_id }),
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

export function migrateAgentsProfileColumns(db: Database) {
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

export function readAgents(db: Database): RegistryAgent[] {
  return db
    .query("SELECT * FROM registry_agent ORDER BY updated_at, agent_id")
    .all()
    .map((row) => rowToAgent(row as AgentRow))
}

export function readPendingDeliveries(db: Database): RegistryPendingDelivery[] {
  return db
    .query("SELECT * FROM registry_pending_delivery ORDER BY created_at, id")
    .all()
    .map((row) => rowToDelivery(row as DeliveryRow))
}

export function writeAgentsAndDeliveries(
  db: Database,
  agents: RegistryAgent[],
  pendingDeliveries: RegistryPendingDelivery[],
) {
  db.exec("DELETE FROM registry_agent")
  db.exec("DELETE FROM registry_pending_delivery")
  const insertAgent = db.prepare(`
        INSERT INTO registry_agent (
          agent_id, scope, profile, session_id, display_name,
          mission_id, node_id, project_terminal_session_id,
          status, created_at, updated_at
        ) VALUES (
          $agent_id, $scope, $profile, $session_id, $display_name,
          $mission_id, $node_id, $project_terminal_session_id,
          $status, $created_at, $updated_at
        )
      `)
  for (const agent of agents) {
    insertAgent.run({
      $agent_id: agent.agentId,
      $scope: agent.scope,
      $profile: agent.profile,
      $session_id: agent.sessionId,
      $display_name: agent.displayName,
      $mission_id: agent.missionId ?? null,
      $node_id: agent.nodeId ?? null,
      $project_terminal_session_id: agent.projectRootSessionId ?? null,
      $status: agent.status,
      $created_at: agent.createdAt,
      $updated_at: agent.updatedAt,
    })
  }
  const insertDelivery = db.prepare(`
        INSERT INTO registry_pending_delivery (
          id, recipient_session_id, recipient_agent_id, sender_agent_id, prompt_text,
          prompt_profile, created_at, attempts, last_attempt_at, last_error, next_retry_at
        ) VALUES (
          $id, $recipient_session_id, $recipient_agent_id, $sender_agent_id, $prompt_text,
          $prompt_profile, $created_at, $attempts, $last_attempt_at, $last_error, $next_retry_at
        )
      `)
  for (const delivery of pendingDeliveries) {
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
}
