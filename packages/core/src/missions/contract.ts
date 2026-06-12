import { RegistryDatabase } from "../registry/db.ts"
import type { RegistryMissionRecord } from "../registry/types.ts"
import type { MissionEntry } from "./parse.ts"
import { normalizeMissionOverrideFields } from "./normalize.ts"

export type MissionContract = {
  mission_id: string
  status: string
  priority?: string
  objective?: string
  done_when: string[]
  must_not: string[]
  notes?: string
  user_topology?: string
  user_skill?: string
  started_at?: string
  completed_at?: string
  locked_at: string
  is_active: boolean
}

export function missionEntryToRecord(
  entry: MissionEntry,
  input: { lockedAt: string; isActive: boolean; status?: string },
): RegistryMissionRecord {
  const now = new Date().toISOString()
  return {
    missionId: entry.id,
    status: input.status ?? entry.status,
    doneWhen: [...entry.done_when],
    mustNot: [...entry.must_not],
    isActive: input.isActive,
    lockedAt: input.lockedAt,
    updatedAt: now,
    ...(entry.priority && { priority: entry.priority }),
    ...(entry.objective && { objective: entry.objective }),
    ...(entry.notes && { notes: entry.notes }),
    ...(entry.user_topology && { userTopology: entry.user_topology }),
    ...(entry.user_skill && { userSkill: entry.user_skill }),
    ...(entry.started_at && { startedAt: entry.started_at }),
    ...(entry.completed_at && { completedAt: entry.completed_at }),
  }
}

export function registryMissionToContract(record: RegistryMissionRecord): MissionContract {
  const overrides = normalizeMissionOverrideFields({
    notes: record.notes,
    user_topology: record.userTopology,
    user_skill: record.userSkill,
  })
  return {
    mission_id: record.missionId,
    status: record.status,
    done_when: [...record.doneWhen],
    must_not: [...record.mustNot],
    locked_at: record.lockedAt,
    is_active: record.isActive,
    ...(record.priority && { priority: record.priority }),
    ...(record.objective && { objective: record.objective }),
    ...overrides,
    ...(record.startedAt && { started_at: record.startedAt }),
    ...(record.completedAt && { completed_at: record.completedAt }),
  }
}

export function readActiveMissionContract(projectDirectory: string, missionId?: string) {
  const record = new RegistryDatabase(projectDirectory, { readonly: true }).getActiveMission()
  if (!record) return undefined
  if (missionId && record.missionId !== missionId) return undefined
  return registryMissionToContract(record)
}

export function requireActiveMissionContract(projectDirectory: string, missionId?: string) {
  const contract = readActiveMissionContract(projectDirectory, missionId)
  if (!contract) {
    const hint = missionId
      ? `No active registry snapshot for mission ${missionId}; call gatehouse_mission_start first`
      : "No active mission in registry; call gatehouse_mission_start first"
    throw new Error(hint)
  }
  return contract
}
