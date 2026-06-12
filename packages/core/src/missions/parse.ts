import { gatehouseMessage } from "../i18n.ts"
import { DEFAULT_GATEHOUSE_LOCALE, type GatehouseLocale } from "../locale.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"
import { normalizeMissionOverrideFields } from "./normalize.ts"

export type MissionEntry = {
  id: string
  status: string
  priority?: string
  objective?: string
  done_when: string[]
  must_not: string[]
  notes?: string
  /** User-explicit topology override for architect; omit when user did not specify. */
  user_topology?: string
  /** User-explicit skill override for curator; omit when user did not specify. */
  user_skill?: string
  started_at?: string
  completed_at?: string
}

export type MissionsDocument = {
  schema_version: number
  missions: MissionEntry[]
}

function formatDoneWhenItem(value: unknown) {
  if (typeof value === "string") return value
  if (isRecord(value)) {
    const pathValue = readString(value.path)
    if (pathValue) return `文件存在: ${pathValue}`
  }
  return undefined
}

export function formatListItems(values: unknown) {
  if (!Array.isArray(values)) return []
  return values.flatMap((item) => {
    const formatted = typeof item === "string" ? item : formatDoneWhenItem(item)
    return formatted ? [formatted] : []
  })
}

function parseMissionEntry(item: Record<string, unknown>): MissionEntry | undefined {
  const id = readString(item.id)
  const status = readString(item.status)
  if (!id || !status) return undefined
  const overrides = normalizeMissionOverrideFields({
    notes: readString(item.notes),
    user_topology: readString(item.user_topology),
    user_skill: readString(item.user_skill),
  })
  return {
    id,
    status,
    done_when: formatListItems(item.done_when),
    must_not: formatListItems(item.must_not),
    ...(readString(item.priority) && { priority: readString(item.priority) }),
    ...(readString(item.objective) && { objective: readString(item.objective) }),
    ...overrides,
    ...(readString(item.started_at) && { started_at: readString(item.started_at) }),
    ...(readString(item.completed_at) && { completed_at: readString(item.completed_at) }),
  }
}

export function parseMissionsFile(text: string): MissionsDocument {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("missions.yaml must be a mapping")
  const schema_version = typeof raw.schema_version === "number" ? raw.schema_version : 1
  const missions = Array.isArray(raw.missions)
    ? raw.missions.flatMap((item): MissionEntry[] => {
        if (!isRecord(item)) return []
        const entry = parseMissionEntry(item)
        return entry ? [entry] : []
      })
    : []
  return { schema_version, missions }
}

export function bulletList(items: string[], locale: GatehouseLocale = DEFAULT_GATEHOUSE_LOCALE) {
  if (items.length === 0) return gatehouseMessage("bulletList.empty", locale)
  return items.map((item) => `- ${item}`).join("\n")
}

export function runningMissionIds(doc: MissionsDocument) {
  return doc.missions.filter((mission) => mission.status === "running").map((mission) => mission.id)
}

export function retroMissionIds(doc: MissionsDocument) {
  return doc.missions.filter((mission) => mission.status === "retro").map((mission) => mission.id)
}

/** Missions still visible on Portal (execution or retro). Serial policy: at most one. */
export function portalMissionIds(doc: MissionsDocument) {
  return activePortalMissionIds(doc)
}

export function activePortalMissionIds(doc: MissionsDocument) {
  const running = doc.missions.filter((mission) => mission.status === "running")
  if (running.length > 0) {
    return [newestMission(running).id]
  }
  const retro = doc.missions.filter((mission) => mission.status === "retro")
  if (retro.length > 0) {
    return [newestMission(retro).id]
  }
  return []
}

/** Newest completed mission shown in the office between active missions. */
export function lingeringPortalMissionId(doc: MissionsDocument) {
  if (activePortalMissionIds(doc).length > 0) return undefined
  const done = doc.missions.filter((mission) => mission.status === "done")
  if (done.length === 0) return undefined
  return newestMission(done).id
}

export function assertCanStartRunning(doc: MissionsDocument) {
  const running = runningMissionIds(doc)
  if (running.length > 0) {
    throw new Error(
      `Cannot start a new mission while another is running: ${running.join(", ")}`,
    )
  }
  const retro = retroMissionIds(doc)
  if (retro.length > 0) {
    throw new Error(
      `Cannot start a new mission while retro is in progress: ${retro.join(", ")}`,
    )
  }
}

export function assertMissionRunning(doc: MissionsDocument, missionId: string) {
  const mission = doc.missions.find((entry) => entry.id === missionId)
  if (!mission) throw new Error(`Mission not found in missions.yaml: ${missionId}`)
  if (mission.status !== "running") {
    throw new Error(
      `Mission ${missionId} must be running before bootstrap (current status: ${mission.status})`,
    )
  }
}

function newestMission(missions: MissionEntry[]) {
  return [...missions].sort((a, b) => missionStartedAt(b) - missionStartedAt(a))[0]!
}

function missionStartedAt(mission: MissionEntry) {
  if (!mission.started_at) return 0
  const time = new Date(mission.started_at).getTime()
  return Number.isNaN(time) ? 0 : time
}
