export const REGISTRY_MISSION_RETRO_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS registry_mission_retro (
      mission_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      retro_session_id TEXT NOT NULL,
      analysis_order_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registry_mission_retro_session_idx
      ON registry_mission_retro(retro_session_id);
`

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
