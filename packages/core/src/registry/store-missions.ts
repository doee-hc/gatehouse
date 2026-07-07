import type { RegistryDatabase } from "./db.ts"
import type { RegistryMissionRecord } from "./types.ts"

export class RegistryStoreMissions {
  constructor(private readonly db: RegistryDatabase) {}

  getActiveMission() {
    return this.db.getActiveMission()
  }

  activateMission(record: RegistryMissionRecord) {
    this.db.activateMission(record)
  }

  syncMissionRegistryStatus(missionId: string, status: string, completedAt?: string) {
    this.db.updateMissionStatus(missionId, status, completedAt)
    if (status === "done" || status === "cancelled") this.db.deactivateMission(missionId)
  }
}
