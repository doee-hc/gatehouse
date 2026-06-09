import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import type { RegistryAgentTarget } from "./agent-target.ts"

function globalOpencodeAgentDir() {
  const fromEnv = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR?.trim()
  if (fromEnv) return path.join(path.resolve(fromEnv), "agent")
  return path.join(homedir(), ".config", "opencode", "agent")
}

function readFrontmatterDescription(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return undefined
  const line = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  return line?.replace(/^["']|["']$/g, "")
}

export function readOuterProfileDescriptions() {
  const descriptions = new Map<string, string>()
  const dir = globalOpencodeAgentDir()
  if (!existsSync(dir)) return descriptions
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue
    const profile = path.basename(file, ".md")
    const text = readFileSync(path.join(dir, file), "utf8")
    const description = readFrontmatterDescription(text)
    if (description) descriptions.set(profile, description)
  }
  return descriptions
}

function registryDbPath(projectDir: string) {
  return path.join(projectDir, ".gatehouse", "registry.db")
}

function readTreeNodeDescriptions(projectDir: string, missionIds: string[]) {
  const descriptions = new Map<string, string>()
  if (missionIds.length === 0) return descriptions
  const dbPath = registryDbPath(projectDir)
  if (!existsSync(dbPath)) return descriptions
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout = 5000;")
    const hasTable = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'registry_tree_node' LIMIT 1")
      .get()
    if (!hasTable) return descriptions
    const query = db.query(
      `SELECT node_id, description, display_name
       FROM registry_tree_node
       WHERE mission_id = ?`,
    )
    for (const missionId of missionIds) {
      const rows = query.all(missionId) as Array<{
        node_id: string
        description: string | null
        display_name: string | null
      }>
      for (const row of rows) {
        const description = row.description?.trim() || row.display_name?.trim()
        if (description) descriptions.set(`${missionId}:${row.node_id}`, description)
      }
    }
    return descriptions
  } finally {
    db.close()
  }
}

export function resolveAgentDescription(
  agent: RegistryAgentTarget,
  outerByProfile: Map<string, string>,
  treeByMissionNode: Map<string, string>,
) {
  if (agent.scope === "outer") {
    return outerByProfile.get(agent.opencodeAgent) ?? agent.displayName
  }
  if (agent.missionId && agent.nodeId) {
    return treeByMissionNode.get(`${agent.missionId}:${agent.nodeId}`) ?? agent.displayName
  }
  return agent.displayName
}

export function loadAgentDescriptions(projectDir: string, agents: RegistryAgentTarget[]) {
  const outerByProfile = readOuterProfileDescriptions()
  const missionIds = [...new Set(agents.flatMap((agent) => (agent.missionId ? [agent.missionId] : [])))]
  const treeByMissionNode = readTreeNodeDescriptions(projectDir, missionIds)
  const descriptions = new Map<string, string>()
  for (const agent of agents) {
    descriptions.set(agent.agentId, resolveAgentDescription(agent, outerByProfile, treeByMissionNode))
  }
  return descriptions
}
