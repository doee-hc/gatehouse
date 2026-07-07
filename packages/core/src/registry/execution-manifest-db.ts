import type { Database } from "bun:sqlite"
import type { MissionManifest, MissionNode } from "../missions/manifest/types.ts"

type ExecutionRow = {
  mission_id: string
  status: string
  terminal_node: string
  created_at: string
  archived_at: string | null
}

type ExecutionNodeRow = {
  mission_id: string
  node_id: string
  session_id: string
  display_name: string | null
  description: string | null
  profile: string | null
  skill_domain: string | null
}

function rowsToManifest(row: ExecutionRow, nodeRows: ExecutionNodeRow[]): MissionManifest {
  const nodes: Record<string, MissionNode> = {}
  for (const nodeRow of nodeRows) {
    nodes[nodeRow.node_id] = {
      session_id: nodeRow.session_id,
      ...(nodeRow.display_name && { display_name: nodeRow.display_name }),
      ...(nodeRow.description && { description: nodeRow.description }),
      ...(nodeRow.profile && { profile: nodeRow.profile }),
      ...(nodeRow.skill_domain && { skill_domain: nodeRow.skill_domain }),
    }
  }
  return {
    mission_id: row.mission_id,
    status: row.status as MissionManifest["status"],
    terminal_node: row.terminal_node,
    created_at: row.created_at,
    nodes,
    ...(row.archived_at && { archived_at: row.archived_at }),
  }
}

export function getMissionManifest(db: Database, missionId: string) {
  const row = db
    .query("SELECT * FROM registry_execution WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as ExecutionRow | undefined
  if (!row) return undefined
  const nodeRows = db
    .query("SELECT * FROM registry_execution_node WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId }) as ExecutionNodeRow[]
  return rowsToManifest(row, nodeRows)
}

export function saveMissionManifest(db: Database, manifest: MissionManifest) {
  db.exec("BEGIN")
  try {
    const upsertExecution = db.prepare(`
      INSERT INTO registry_execution (mission_id, status, terminal_node, created_at, archived_at)
      VALUES ($mission_id, $status, $terminal_node, $created_at, $archived_at)
      ON CONFLICT(mission_id) DO UPDATE SET
        status = excluded.status,
        terminal_node = excluded.terminal_node,
        created_at = excluded.created_at,
        archived_at = excluded.archived_at
    `)
    upsertExecution.run({
      $mission_id: manifest.mission_id,
      $status: manifest.status,
      $terminal_node: manifest.terminal_node,
      $created_at: manifest.created_at,
      $archived_at: manifest.archived_at ?? null,
    })
    db.prepare("DELETE FROM registry_execution_node WHERE mission_id = $mission_id").run({
      $mission_id: manifest.mission_id,
    })
    const insertNode = db.prepare(`
      INSERT INTO registry_execution_node (
        mission_id, node_id, session_id, display_name, description, profile, skill_domain
      ) VALUES (
        $mission_id, $node_id, $session_id, $display_name, $description, $profile, $skill_domain
      )
    `)
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      insertNode.run({
        $mission_id: manifest.mission_id,
        $node_id: nodeId,
        $session_id: node.session_id,
        $display_name: node.display_name ?? null,
        $description: node.description ?? null,
        $profile: node.profile ?? null,
        $skill_domain: node.skill_domain ?? null,
      })
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function listMissionIds(db: Database, status?: MissionManifest["status"]) {
  const rows = status
    ? (db
        .query("SELECT mission_id FROM registry_execution WHERE status = $status ORDER BY created_at")
        .all({ $status: status }) as Array<{ mission_id: string }>)
    : (db.query("SELECT mission_id FROM registry_execution ORDER BY created_at").all() as Array<{
        mission_id: string
      }>)
  return rows.map((row) => row.mission_id)
}

export function findMissionManifestByExecSession(db: Database, sessionId: string) {
  const node = db
    .query(
      "SELECT mission_id FROM registry_execution_node WHERE session_id = $session_id LIMIT 1",
    )
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!node) return undefined
  const manifest = getMissionManifest(db, node.mission_id)
  if (!manifest) return undefined
  return { missionId: node.mission_id, manifest }
}
