import type { MissionsDocument } from "../missions/parse.ts"
import { RegistryDatabase } from "./db.ts"
import type { RegistrySnapshot } from "./types.ts"

function deactivateInnerAgents(snapshot: RegistrySnapshot, missionIds: Iterable<string>) {
  const ids = new Set(missionIds)
  if (ids.size === 0) return { snapshot, count: 0 }

  const updatedAt = new Date().toISOString()
  let count = 0
  const agents = snapshot.agents.map((agent) => {
    if (agent.scope !== "inner" || !agent.missionId || !ids.has(agent.missionId)) return agent
    if (agent.status !== "active") return agent
    count++
    return { ...agent, status: "completed" as const, updatedAt }
  })
  if (count === 0) return { snapshot, count: 0 }
  return { snapshot: { ...snapshot, agents, updatedAt }, count }
}

export function deactivateInnerAgentsForMissions(projectDirectory: string, missionIds: Iterable<string>) {
  const db = new RegistryDatabase(projectDirectory)
  const result = deactivateInnerAgents(db.load(), missionIds)
  if (result.count === 0) return 0
  db.save(result.snapshot)
  return result.count
}

export function reconcileInactiveMissionInnerAgents(projectDirectory: string, doc: MissionsDocument) {
  const missionIds = doc.missions
    .filter((mission) => mission.status === "done" || mission.status === "cancelled")
    .map((mission) => mission.id)
  return deactivateInnerAgentsForMissions(projectDirectory, missionIds)
}

function deactivateRetroAgents(snapshot: RegistrySnapshot, missionIds: Iterable<string>) {
  const ids = new Set(missionIds)
  if (ids.size === 0) return { snapshot, count: 0 }

  const updatedAt = new Date().toISOString()
  let count = 0
  const agents = snapshot.agents.map((agent) => {
    if (agent.scope !== "retro" || !agent.missionId || !ids.has(agent.missionId)) return agent
    if (agent.status !== "active") return agent
    count++
    return { ...agent, status: "completed" as const, updatedAt }
  })
  if (count === 0) return { snapshot, count: 0 }
  return { snapshot: { ...snapshot, agents, updatedAt }, count }
}

export function deactivateRetroAgentsForMissions(projectDirectory: string, missionIds: Iterable<string>) {
  const db = new RegistryDatabase(projectDirectory)
  const result = deactivateRetroAgents(db.load(), missionIds)
  if (result.count === 0) return 0
  db.save(result.snapshot)
  return result.count
}

function deactivateScopedAgents(
  snapshot: RegistrySnapshot,
  missionIds: Iterable<string>,
  scope: RegistrySnapshot["agents"][number]["scope"],
) {
  const ids = new Set(missionIds)
  if (ids.size === 0) return { snapshot, count: 0 }

  const updatedAt = new Date().toISOString()
  let count = 0
  const agents = snapshot.agents.map((agent) => {
    if (agent.scope !== scope || !agent.missionId || !ids.has(agent.missionId)) return agent
    if (agent.status !== "active") return agent
    count++
    return { ...agent, status: "completed" as const, updatedAt }
  })
  if (count === 0) return { snapshot, count: 0 }
  return { snapshot: { ...snapshot, agents, updatedAt }, count }
}

export function deactivateExtractAgentsForMissions(projectDirectory: string, missionIds: Iterable<string>) {
  const db = new RegistryDatabase(projectDirectory)
  const result = deactivateScopedAgents(db.load(), missionIds, "extract")
  if (result.count === 0) return 0
  db.save(result.snapshot)
  return result.count
}

export function deactivateVerifyAgentsForMissions(projectDirectory: string, missionIds: Iterable<string>) {
  const db = new RegistryDatabase(projectDirectory)
  const result = deactivateScopedAgents(db.load(), missionIds, "verify")
  if (result.count === 0) return 0
  db.save(result.snapshot)
  return result.count
}

export function reconcileCompletedRetroAgents(projectDirectory: string) {
  const db = new RegistryDatabase(projectDirectory)
  const snapshot = db.load()
  const updatedAt = new Date().toISOString()
  let count = 0
  const agents = snapshot.agents.map((agent) => {
    if (agent.scope !== "retro" || agent.status !== "active" || !agent.missionId) return agent
    const run = snapshot.retroRuns.find((item) => item.missionId === agent.missionId)
    if (!run?.retroSummarySubmittedAt) return agent
    count++
    return { ...agent, status: "completed" as const, updatedAt }
  })
  if (count === 0) return 0
  db.save({ ...snapshot, agents, updatedAt })
  return count
}
