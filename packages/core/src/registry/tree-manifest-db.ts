import type { Database } from "bun:sqlite"
import { REGISTRY_SCHEMA_VERSION } from "./types.ts"
import type { RetroManifest, TreeManifest, TreeNode } from "../tree/types.ts"

type TreeRow = {
  mission_id: string
  status: string
  root_node: string
  created_at: string
  archived_at: string | null
}

type TreeNodeRow = {
  mission_id: string
  node_id: string
  session_id: string
  parent_node_id: string | null
  display_name: string | null
  description: string | null
  profile: string | null
  skill_domain: string | null
}

type RetroRow = {
  mission_id: string
  created_at: string
  retro_order_json: string
}

type RetroNodeRow = {
  mission_id: string
  node_id: string
  exec_session_id: string
  retro_session_id: string
  child_nodes_json: string
}

function rowsToManifest(tree: TreeRow, nodeRows: TreeNodeRow[]): TreeManifest {
  const nodes: Record<string, TreeNode> = {}
  for (const row of nodeRows) {
    nodes[row.node_id] = {
      session_id: row.session_id,
      parent: row.parent_node_id,
      ...(row.display_name && { display_name: row.display_name }),
      ...(row.description && { description: row.description }),
      ...(row.profile && { profile: row.profile }),
      ...(row.skill_domain && { skill_domain: row.skill_domain }),
    }
  }
  return {
    mission_id: tree.mission_id,
    status: tree.status as TreeManifest["status"],
    root_node: tree.root_node,
    created_at: tree.created_at,
    nodes,
    ...(tree.archived_at && { archived_at: tree.archived_at }),
  }
}

function rowsToRetro(tree: RetroRow, nodeRows: RetroNodeRow[]): RetroManifest {
  const nodes: RetroManifest["nodes"] = {}
  for (const row of nodeRows) {
    nodes[row.node_id] = {
      exec_session_id: row.exec_session_id,
      retro_session_id: row.retro_session_id,
      child_nodes: JSON.parse(row.child_nodes_json) as string[],
    }
  }
  return {
    mission_id: tree.mission_id,
    created_at: tree.created_at,
    retro_order: JSON.parse(tree.retro_order_json) as string[],
    nodes,
  }
}

export function getTreeManifest(db: Database, missionId: string) {
  const tree = db
    .query("SELECT * FROM registry_tree WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as TreeRow | undefined
  if (!tree) return undefined
  const nodeRows = db
    .query("SELECT * FROM registry_tree_node WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId }) as TreeNodeRow[]
  return rowsToManifest(tree, nodeRows)
}

export function saveTreeManifest(db: Database, manifest: TreeManifest) {
  db.exec("BEGIN")
  try {
    const upsertTree = db.prepare(`
      INSERT INTO registry_tree (mission_id, status, root_node, created_at, archived_at)
      VALUES ($mission_id, $status, $root_node, $created_at, $archived_at)
      ON CONFLICT(mission_id) DO UPDATE SET
        status = excluded.status,
        root_node = excluded.root_node,
        created_at = excluded.created_at,
        archived_at = excluded.archived_at
    `)
    upsertTree.run({
      $mission_id: manifest.mission_id,
      $status: manifest.status,
      $root_node: manifest.root_node,
      $created_at: manifest.created_at,
      $archived_at: manifest.archived_at ?? null,
    })
    db.prepare("DELETE FROM registry_tree_node WHERE mission_id = $mission_id").run({
      $mission_id: manifest.mission_id,
    })
    const insertNode = db.prepare(`
      INSERT INTO registry_tree_node (
        mission_id, node_id, session_id, parent_node_id, display_name, description, profile, skill_domain
      ) VALUES (
        $mission_id, $node_id, $session_id, $parent_node_id, $display_name, $description, $profile, $skill_domain
      )
    `)
    for (const [nodeId, node] of Object.entries(manifest.nodes)) {
      insertNode.run({
        $mission_id: manifest.mission_id,
        $node_id: nodeId,
        $session_id: node.session_id,
        $parent_node_id: node.parent,
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

export function listTreeMissionIds(db: Database, status?: TreeManifest["status"]) {
  const rows = status
    ? (db
        .query("SELECT mission_id FROM registry_tree WHERE status = $status ORDER BY created_at")
        .all({ $status: status }) as Array<{ mission_id: string }>)
    : (db.query("SELECT mission_id FROM registry_tree ORDER BY created_at").all() as Array<{
        mission_id: string
      }>)
  return rows.map((row) => row.mission_id)
}

export function findTreeManifestByExecSession(db: Database, sessionId: string) {
  const node = db
    .query(
      "SELECT mission_id FROM registry_tree_node WHERE session_id = $session_id LIMIT 1",
    )
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!node) return undefined
  const manifest = getTreeManifest(db, node.mission_id)
  if (!manifest) return undefined
  return { missionId: node.mission_id, manifest }
}

export function getRetroManifest(db: Database, missionId: string) {
  const tree = db
    .query("SELECT * FROM registry_retro_tree WHERE mission_id = $mission_id")
    .get({ $mission_id: missionId }) as RetroRow | undefined
  if (!tree) return undefined
  const nodeRows = db
    .query("SELECT * FROM registry_retro_tree_node WHERE mission_id = $mission_id ORDER BY node_id")
    .all({ $mission_id: missionId }) as RetroNodeRow[]
  return rowsToRetro(tree, nodeRows)
}

export function saveRetroManifest(db: Database, retro: RetroManifest) {
  db.exec("BEGIN")
  try {
    const upsert = db.prepare(`
      INSERT INTO registry_retro_tree (mission_id, created_at, retro_order_json)
      VALUES ($mission_id, $created_at, $retro_order_json)
      ON CONFLICT(mission_id) DO UPDATE SET
        created_at = excluded.created_at,
        retro_order_json = excluded.retro_order_json
    `)
    upsert.run({
      $mission_id: retro.mission_id,
      $created_at: retro.created_at,
      $retro_order_json: JSON.stringify(retro.retro_order),
    })
    db.prepare("DELETE FROM registry_retro_tree_node WHERE mission_id = $mission_id").run({
      $mission_id: retro.mission_id,
    })
    const insertNode = db.prepare(`
      INSERT INTO registry_retro_tree_node (
        mission_id, node_id, exec_session_id, retro_session_id, child_nodes_json
      ) VALUES (
        $mission_id, $node_id, $exec_session_id, $retro_session_id, $child_nodes_json
      )
    `)
    for (const [nodeId, node] of Object.entries(retro.nodes)) {
      insertNode.run({
        $mission_id: retro.mission_id,
        $node_id: nodeId,
        $exec_session_id: node.exec_session_id,
        $retro_session_id: node.retro_session_id,
        $child_nodes_json: JSON.stringify(node.child_nodes),
      })
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function findTreeManifestByRetroSession(db: Database, sessionId: string) {
  const node = db
    .query(
      "SELECT mission_id FROM registry_retro_tree_node WHERE retro_session_id = $session_id LIMIT 1",
    )
    .get({ $session_id: sessionId }) as { mission_id: string } | undefined
  if (!node) return undefined
  const retro = getRetroManifest(db, node.mission_id)
  const manifest = getTreeManifest(db, node.mission_id)
  if (!retro || !manifest) return undefined
  return { missionId: node.mission_id, manifest, retro }
}

function treeNodeColumnNames(db: Database) {
  const table = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'registry_tree_node'")
    .get()
  if (!table) return new Set<string>()
  const columns = db.query("PRAGMA table_info(registry_tree_node)").all() as Array<{ name: string }>
  return new Set(columns.map((column) => column.name))
}

export function migrateTreeManifestDisplayName(db: Database) {
  const names = treeNodeColumnNames(db)
  if (names.has("title") && !names.has("display_name")) {
    db.exec("ALTER TABLE registry_tree_node RENAME COLUMN title TO display_name")
  }
}

export function migrateTreeManifestProfileColumn(db: Database) {
  const names = treeNodeColumnNames(db)
  if (names.has("agent") && !names.has("profile")) {
    db.exec("ALTER TABLE registry_tree_node RENAME COLUMN agent TO profile")
  }
}

export function migrateTreeManifestDescriptionColumn(db: Database) {
  const names = treeNodeColumnNames(db)
  if (names.size === 0) return
  if (!names.has("description")) {
    db.exec("ALTER TABLE registry_tree_node ADD COLUMN description TEXT")
  }
}

export const TREE_MANIFEST_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS registry_tree (
      mission_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      root_node TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS registry_tree_status_idx ON registry_tree(status);

    CREATE TABLE IF NOT EXISTS registry_tree_node (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      parent_node_id TEXT,
      display_name TEXT,
      description TEXT,
      profile TEXT,
      skill_domain TEXT,
      PRIMARY KEY (mission_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS registry_tree_node_session_idx ON registry_tree_node(session_id);
    CREATE INDEX IF NOT EXISTS registry_tree_node_mission_idx ON registry_tree_node(mission_id);

    CREATE TABLE IF NOT EXISTS registry_retro_tree (
      mission_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      retro_order_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_retro_tree_node (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      exec_session_id TEXT NOT NULL,
      retro_session_id TEXT NOT NULL,
      child_nodes_json TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS registry_retro_tree_node_retro_session_idx
      ON registry_retro_tree_node(retro_session_id);
`
