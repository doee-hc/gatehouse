import type { Database } from "bun:sqlite"
import type { MissionManifestIndex, MissionManifestIndexEntry } from "../missions/manifest/types.ts"

type MissionManifestIndexRow = {
  mission_id: string
  status: string
  terminal_node: string
  created_at: string
  terminal_session_id: string | null
  objective: string | null
}

export function listMissionManifestIndex(db: Database): MissionManifestIndex {
  const rows = db
    .query(
      `SELECT e.mission_id, e.status, e.terminal_node, e.created_at,
              n.session_id AS terminal_session_id, m.objective AS objective
       FROM registry_execution e
       LEFT JOIN registry_execution_node n
         ON n.mission_id = e.mission_id AND n.node_id = e.terminal_node
       LEFT JOIN registry_mission m ON m.mission_id = e.mission_id
       ORDER BY e.created_at DESC`,
    )
    .all() as MissionManifestIndexRow[]
  const missions = rows
    .map((row): MissionManifestIndexEntry | undefined => {
      if (!row.terminal_session_id) return undefined
      return {
        mission_id: row.mission_id,
        terminal_session_id: row.terminal_session_id,
        terminal_node: row.terminal_node,
        status: row.status,
        created_at: row.created_at,
        ...(row.objective && { objective: row.objective }),
      }
    })
    .filter((entry): entry is MissionManifestIndexEntry => entry !== undefined)
  return { missions }
}
