import path from "node:path"

export type MissionEntry = {
  id: string
  status: string
  started_at?: string
}

export type MissionsDocument = {
  missions: MissionEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function parseMissionsFile(text: string): MissionsDocument {
  if (typeof Bun === "undefined" || !("YAML" in Bun) || typeof Bun.YAML.parse !== "function") {
    throw new Error("Bun.YAML.parse is required to read missions.yaml")
  }
  const raw = Bun.YAML.parse(text)
  if (!isRecord(raw)) return { missions: [] }
  const missions = Array.isArray(raw.missions)
    ? raw.missions.flatMap((item): MissionEntry[] => {
        if (!isRecord(item)) return []
        const id = readString(item.id)
        const status = readString(item.status)
        if (!id || !status) return []
        return [
          {
            id,
            status,
            ...(readString(item.started_at) && { started_at: readString(item.started_at) }),
          },
        ]
      })
    : []
  return { missions }
}

function newestMission(missions: MissionEntry[]) {
  return [...missions].sort((a, b) => missionStartedAt(b) - missionStartedAt(a))[0]!
}

function missionStartedAt(mission: MissionEntry) {
  if (!mission.started_at) return 0
  const time = new Date(mission.started_at).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** Aligns with @gatehouse/core activePortalMissionIds: one portal-visible mission. */
export async function readCurrentMissionId(projectDir: string) {
  const file = Bun.file(path.join(projectDir, ".gatehouse", "lead", "missions.yaml"))
  if (!(await file.exists())) return undefined
  const doc = parseMissionsFile(await file.text())
  const running = doc.missions.filter((mission) => mission.status === "running")
  if (running.length > 0) return newestMission(running).id
  const retro = doc.missions.filter((mission) => mission.status === "retro")
  if (retro.length > 0) return newestMission(retro).id
  return undefined
}
