import path from "node:path"
import { leadDir, missionDir } from "../src/paths.ts"
import { parseMissionsFile, type MissionEntry } from "../src/missions/parse.ts"
import { readMissionsDocument, writeMissionsDocument } from "../src/missions/store.ts"
import { missionEntryToRecord } from "../src/missions/contract.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { writeActiveMission } from "../src/portal/active-mission.ts"

const fixtureRoot = path.join(import.meta.dir, "fixtures/core-example-smoke-v1")
const missionId = "core-example-smoke-v1"

function exampleMissionEntry(): MissionEntry {
  return {
    id: missionId,
    status: "running",
    objective: "完善 packages/core 示例说明，验证 scaffold 与 mission.script.ts 可解析",
    done_when: [
      "packages/core/README.md 含「示例 Mission」章节",
      "文件存在: packages/core/README.md",
      "mission.script.ts 与 registry 任务快照可被 @gatehouse/core 解析",
    ],
    must_not: ["不新增 plugin tool", "不修改无关包"],
    notes: "轻装 smoke 示例；验证 scaffold 与 mission 管道。",
    started_at: new Date().toISOString(),
  }
}

export function seedActiveMissionRegistry(
  projectDirectory: string,
  missionId: string,
  status: MissionEntry["status"] = "running",
) {
  const lockedAt = new Date().toISOString()
  new RegistryDatabase(projectDirectory).activateMission(
    missionEntryToRecord(
      { id: missionId, status, done_when: [], must_not: [] },
      { lockedAt, isActive: true, status },
    ),
  )
}

export async function seedExampleMissionRegistry(projectDirectory: string) {
  const entry = exampleMissionEntry()
  const lockedAt = entry.started_at ?? new Date().toISOString()
  new RegistryDatabase(projectDirectory).activateMission(
    missionEntryToRecord(entry, { lockedAt, isActive: true, status: "running" }),
  )
  await writeActiveMission(projectDirectory, missionId)
}

export async function copyExampleMission(projectDir: string) {
  const destRoot = missionDir(projectDir, missionId)
  await Bun.$`mkdir -p ${destRoot}`.quiet()
  await Bun.write(path.join(destRoot, "mission.script.ts"), Bun.file(path.join(fixtureRoot, "mission.script.ts")))

  const missionsPath = path.join(leadDir(projectDir), "missions.yaml")
  const entry = exampleMissionEntry()
  const missions = (await Bun.file(missionsPath).exists())
    ? parseMissionsFile(await Bun.file(missionsPath).text())
    : { schema_version: 2, missions: [] as MissionEntry[] }

  const without = missions.missions.filter((item) => item.id !== missionId)
  without.push(entry)
  missions.missions = without
  await writeMissionsDocument(projectDir, { schema_version: missions.schema_version, missions: without })

  await seedExampleMissionRegistry(projectDir)
}

/** Queued entry in yaml only (tests gatehouse_mission_start). */
export async function copyExampleMissionQueued(projectDir: string) {
  const destRoot = missionDir(projectDir, missionId)
  await Bun.$`mkdir -p ${destRoot}`.quiet()
  await Bun.write(path.join(destRoot, "mission.script.ts"), Bun.file(path.join(fixtureRoot, "mission.script.ts")))

  const entry = exampleMissionEntry()
  entry.status = "queued"
  entry.started_at = undefined

  const missionsPath = path.join(leadDir(projectDir), "missions.yaml")
  const missions = (await Bun.file(missionsPath).exists())
    ? parseMissionsFile(await Bun.file(missionsPath).text())
    : { schema_version: 2, missions: [] as MissionEntry[] }
  const without = missions.missions.filter((item) => item.id !== missionId)
  without.push(entry)
  await writeMissionsDocument(projectDir, { schema_version: missions.schema_version, missions: without })
}
