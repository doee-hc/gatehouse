import type { Database } from "bun:sqlite"
import type { MissionVerifyManifest } from "../missions/manifest/types.ts"
import { getMissionManifest } from "./execution-manifest-db.ts"

type VerifyNodeRow = {
  mission_id: string
  node_id: string
  extract_session_id: string
  verify_session_id: string
  skill_domain: string
}

type VerifyRow = {
  mission_id: string
  created_at: string
  verify_order_json: string
}

function rowsToVerify(row: VerifyRow, nodeRows: VerifyNodeRow[]): MissionVerifyManifest {
  const nodes: MissionVerifyManifest["nodes"] = {}
  for (const nodeRow of nodeRows) {
    nodes[nodeRow.node_id] = {
      extract_session_id: nodeRow.extract_session_id,
      verify_session_id: nodeRow.verify_session_id,
      skill_domain: nodeRow.skill_domain,
    }
  }
  return {
    mission_id: row.mission_id,
    created_at: row.created_at,
    verify_order: JSON.parse(row.verify_order_json) as string[],
    nodes,
  }
}

export function getVerifyManifest(db: Database, missionId: string) {
  const row = db
    .query("SELECT * FROM registry_mission_verify WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as VerifyRow | undefined
  if (!row) return undefined
  const nodeRows = db
    .query("SELECT * FROM registry_mission_verify_node WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId }) as VerifyNodeRow[]
  return rowsToVerify(row, nodeRows)
}

export function saveVerifyManifest(db: Database, verify: MissionVerifyManifest) {
  db.exec("BEGIN")
  try {
    db.prepare(`
      INSERT INTO registry_mission_verify (mission_id, created_at, verify_order_json)
      VALUES ($mission_id, $created_at, $verify_order_json)
      ON CONFLICT(mission_id) DO UPDATE SET
        created_at = excluded.created_at,
        verify_order_json = excluded.verify_order_json
    `).run({
      $mission_id: verify.mission_id,
      $created_at: verify.created_at,
      $verify_order_json: JSON.stringify(verify.verify_order),
    })
    db.prepare("DELETE FROM registry_mission_verify_node WHERE mission_id = $mission_id").run({
      $mission_id: verify.mission_id,
    })
    const insertNode = db.prepare(`
      INSERT INTO registry_mission_verify_node (
        mission_id, node_id, extract_session_id, verify_session_id, skill_domain
      ) VALUES (
        $mission_id, $node_id, $extract_session_id, $verify_session_id, $skill_domain
      )
    `)
    for (const [nodeId, node] of Object.entries(verify.nodes)) {
      insertNode.run({
        $mission_id: verify.mission_id,
        $node_id: nodeId,
        $extract_session_id: node.extract_session_id,
        $verify_session_id: node.verify_session_id,
        $skill_domain: node.skill_domain,
      })
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function findMissionManifestByVerifySession(db: Database, sessionId: string) {
  const node = db
    .query(
      "SELECT mission_id FROM registry_mission_verify_node WHERE verify_session_id = $session_id LIMIT 1",
    )
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!node) return undefined
  const verify = getVerifyManifest(db, node.mission_id)
  const manifest = getMissionManifest(db, node.mission_id)
  if (!verify || !manifest) return undefined
  return { missionId: node.mission_id, manifest, verify }
}
