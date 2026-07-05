import type { Database } from "bun:sqlite"
import type {
  MissionExtractManifest,
  MissionManifest,
  MissionManifestIndex,
  MissionManifestIndexEntry,
  MissionNode,
  MissionRetroManifest,
  MissionVerifyManifest,
} from "../missions/manifest/types.ts"

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

type RetroRow = {
  mission_id: string
  created_at: string
  retro_session_id: string
  analysis_order_json: string
}

type VerifyNodeRow = {
  mission_id: string
  node_id: string
  extract_session_id: string
  verify_session_id: string
  skill_domain: string
}

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

type VerifyRow = {
  mission_id: string
  created_at: string
  verify_order_json: string
}

function rowsToRetro(row: RetroRow): MissionRetroManifest {
  return {
    mission_id: row.mission_id,
    created_at: row.created_at,
    retro_session_id: row.retro_session_id,
    analysis_order: JSON.parse(row.analysis_order_json) as string[],
  }
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

export const MISSION_MANIFEST_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS registry_execution (
      mission_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      terminal_node TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS registry_execution_status_idx ON registry_execution(status);

    CREATE TABLE IF NOT EXISTS registry_execution_node (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      profile TEXT,
      skill_domain TEXT,
      PRIMARY KEY (mission_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS registry_execution_node_session_idx ON registry_execution_node(session_id);
    CREATE INDEX IF NOT EXISTS registry_execution_node_mission_idx ON registry_execution_node(mission_id);

    CREATE TABLE IF NOT EXISTS registry_mission_retro (
      mission_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      retro_session_id TEXT NOT NULL,
      analysis_order_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registry_mission_retro_session_idx
      ON registry_mission_retro(retro_session_id);

    CREATE TABLE IF NOT EXISTS registry_mission_extract (
      mission_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      extract_order_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_mission_extract_node (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      exec_session_id TEXT NOT NULL,
      extract_session_id TEXT NOT NULL,
      skill_domain TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS registry_mission_extract_node_extract_session_idx
      ON registry_mission_extract_node(extract_session_id);

    CREATE TABLE IF NOT EXISTS registry_mission_verify (
      mission_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      verify_order_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_mission_verify_node (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      extract_session_id TEXT NOT NULL,
      verify_session_id TEXT NOT NULL,
      skill_domain TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS registry_mission_verify_node_verify_session_idx
      ON registry_mission_verify_node(verify_session_id);
`
