import type { Database } from "bun:sqlite"
import type { MissionExtractManifest } from "../missions/manifest/types.ts"
import { getMissionManifest } from "./execution-manifest-db.ts"

type ExtractNodeRow = {
  mission_id: string
  node_id: string
  exec_session_id: string
  extract_session_id: string
  skill_domain: string
}

type ExtractRow = {
  mission_id: string
  created_at: string
  extract_order_json: string
}

function rowsToExtract(row: ExtractRow, nodeRows: ExtractNodeRow[]): MissionExtractManifest {
  const nodes: MissionExtractManifest["nodes"] = {}
  for (const nodeRow of nodeRows) {
    nodes[nodeRow.node_id] = {
      exec_session_id: nodeRow.exec_session_id,
      extract_session_id: nodeRow.extract_session_id,
      skill_domain: nodeRow.skill_domain,
    }
  }
  return {
    mission_id: row.mission_id,
    created_at: row.created_at,
    extract_order: JSON.parse(row.extract_order_json) as string[],
    nodes,
  }
}

export function getExtractManifest(db: Database, missionId: string) {
  const row = db
    .query("SELECT * FROM registry_mission_extract WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as ExtractRow | undefined
  if (!row) return undefined
  const nodeRows = db
    .query("SELECT * FROM registry_mission_extract_node WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId }) as ExtractNodeRow[]
  return rowsToExtract(row, nodeRows)
}

export function saveExtractManifest(db: Database, extract: MissionExtractManifest) {
  db.exec("BEGIN")
  try {
    db.prepare(`
      INSERT INTO registry_mission_extract (mission_id, created_at, extract_order_json)
      VALUES ($mission_id, $created_at, $extract_order_json)
      ON CONFLICT(mission_id) DO UPDATE SET
        created_at = excluded.created_at,
        extract_order_json = excluded.extract_order_json
    `).run({
      $mission_id: extract.mission_id,
      $created_at: extract.created_at,
      $extract_order_json: JSON.stringify(extract.extract_order),
    })
    db.prepare("DELETE FROM registry_mission_extract_node WHERE mission_id = $mission_id").run({
      $mission_id: extract.mission_id,
    })
    const insertNode = db.prepare(`
      INSERT INTO registry_mission_extract_node (
        mission_id, node_id, exec_session_id, extract_session_id, skill_domain
      ) VALUES (
        $mission_id, $node_id, $exec_session_id, $extract_session_id, $skill_domain
      )
    `)
    for (const [nodeId, node] of Object.entries(extract.nodes)) {
      insertNode.run({
        $mission_id: extract.mission_id,
        $node_id: nodeId,
        $exec_session_id: node.exec_session_id,
        $extract_session_id: node.extract_session_id,
        $skill_domain: node.skill_domain,
      })
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function findMissionManifestByExtractSession(db: Database, sessionId: string) {
  const node = db
    .query(
      "SELECT mission_id FROM registry_mission_extract_node WHERE extract_session_id = $session_id LIMIT 1",
    )
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!node) return undefined
  const extract = getExtractManifest(db, node.mission_id)
  const manifest = getMissionManifest(db, node.mission_id)
  if (!extract || !manifest) return undefined
  return { missionId: node.mission_id, manifest, extract }
}
