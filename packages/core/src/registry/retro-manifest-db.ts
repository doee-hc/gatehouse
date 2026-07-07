import type { Database } from "bun:sqlite"
import type { MissionRetroManifest } from "../missions/manifest/types.ts"
import { getMissionManifest } from "./execution-manifest-db.ts"

type RetroRow = {
  mission_id: string
  created_at: string
  retro_session_id: string
  analysis_order_json: string
}

function rowsToRetro(row: RetroRow): MissionRetroManifest {
  return {
    mission_id: row.mission_id,
    created_at: row.created_at,
    retro_session_id: row.retro_session_id,
    analysis_order: JSON.parse(row.analysis_order_json) as string[],
  }
}

export function getRetroManifest(db: Database, missionId: string) {
  const row = db
    .query("SELECT * FROM registry_mission_retro WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as RetroRow | undefined
  if (!row) return undefined
  return rowsToRetro(row)
}

export function saveRetroManifest(db: Database, retro: MissionRetroManifest) {
  db.prepare(`
    INSERT INTO registry_mission_retro (mission_id, created_at, retro_session_id, analysis_order_json)
    VALUES ($mission_id, $created_at, $retro_session_id, $analysis_order_json)
    ON CONFLICT(mission_id) DO UPDATE SET
      created_at = excluded.created_at,
      retro_session_id = excluded.retro_session_id,
      analysis_order_json = excluded.analysis_order_json
  `).run({
    $mission_id: retro.mission_id,
    $created_at: retro.created_at,
    $retro_session_id: retro.retro_session_id,
    $analysis_order_json: JSON.stringify(retro.analysis_order),
  })
}

export function findMissionManifestByRetroSession(db: Database, sessionId: string) {
  const row = db
    .query("SELECT mission_id FROM registry_mission_retro WHERE retro_session_id = $session_id LIMIT 1")
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!row) return undefined
  const retro = getRetroManifest(db, row.mission_id)
  const manifest = getMissionManifest(db, row.mission_id)
  if (!retro || !manifest) return undefined
  return { missionId: row.mission_id, manifest, retro }
}
