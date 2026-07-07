import { RegistryDatabase } from "./db.ts"
import type { RegistryDatabaseFacade } from "./db-facades.ts"
import type { RegistrySnapshot } from "./types.ts"

/** Read-only registry access used by portal/TUI snapshots (no agent mutation). */
export type RegistryReadDatabase = Pick<
  RegistryDatabaseFacade,
  | "getActiveMission"
  | "getMission"
  | "listMissionIds"
  | "listMissionManifestIndex"
  | "getMissionManifest"
  | "getLatestOrchestrationPlan"
  | "getOrchestrationState"
  | "getMissionScript"
> & {
  path: string
  load(): RegistrySnapshot
}

export function openRegistryRead(projectDirectory: string): RegistryReadDatabase {
  return new RegistryDatabase(projectDirectory, { readonly: true })
}
