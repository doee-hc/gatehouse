import { buildChannelList } from "./doctor.ts"
import { readLiveSupervisorState, stopSupervisorProcess } from "./state.ts"
import { spawnChannelSupervisor } from "./spawn.ts"
import type { ChannelId } from "./types.ts"

export type ChannelAdminSnapshot = {
  channels: ReturnType<typeof buildChannelList>
  supervisor: {
    running: boolean
    pid?: number
    startedAt?: number
  }
}

export function buildChannelAdminSnapshot(projectDir: string): ChannelAdminSnapshot {
  const supervisor = readLiveSupervisorState(projectDir)
  return {
    channels: buildChannelList(projectDir),
    supervisor: {
      running: Boolean(supervisor),
      pid: supervisor?.pid,
      startedAt: supervisor?.startedAt,
    },
  }
}

export async function startChannelSupervisorFromAdmin(
  projectDir: string,
  channels?: ChannelId[],
  fallbackPackageRoot?: string,
) {
  return spawnChannelSupervisor(projectDir, channels, fallbackPackageRoot)
}

export async function stopChannelSupervisorFromAdmin(projectDir: string) {
  return stopSupervisorProcess(projectDir)
}
