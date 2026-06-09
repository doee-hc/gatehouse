import type { PortalSnapshot } from "../api/types.ts"
import { anyAgentWorking } from "./live-status.ts"
import { isBackendConnected } from "./connection.ts"

export type PortalActivity = "offline" | "standby" | "live" | "retro"

export function resolvePortalActivity(snapshot: PortalSnapshot | undefined): PortalActivity {
  if (!isBackendConnected()) return "offline"
  if (!snapshot) return "standby"

  const hasRunning = snapshot.missions.some((mission) => mission.status === "running")
  if (hasRunning || anyAgentWorking(snapshot)) return "live"

  const hasRetro = snapshot.missions.some((mission) => mission.status === "retro")
  if (hasRetro) return "retro"

  return "standby"
}

export function isQuietOffice(snapshot: PortalSnapshot) {
  if (snapshot.missions.length === 0) return false
  return resolvePortalActivity(snapshot) === "standby"
}
