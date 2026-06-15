import fs from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "../paths.ts"
import { readJsonFile, writeJsonFile } from "../store/files.ts"
import type { ChannelId, SupervisorState } from "./types.ts"

export function supervisorStatePath(projectDir: string) {
  return path.join(resolveChannelStateDir(projectDir, "supervisor"), "state.json")
}

export function readSupervisorState(projectDir: string): SupervisorState | undefined {
  return readJsonFile<SupervisorState>(supervisorStatePath(projectDir))
}

export function writeSupervisorState(projectDir: string, state: SupervisorState) {
  writeJsonFile(supervisorStatePath(projectDir), state)
}

export function clearSupervisorState(projectDir: string) {
  const file = supervisorStatePath(projectDir)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readLiveSupervisorState(projectDir: string): SupervisorState | undefined {
  const state = readSupervisorState(projectDir)
  if (!state?.pid) return undefined
  if (!isProcessAlive(state.pid)) return undefined
  return state
}

export type StopSupervisorResult = {
  stopped: boolean
  reason?: string
  pid?: number
  forced?: boolean
}

export async function stopSupervisorProcess(
  projectDir: string,
  options?: { waitMs?: number },
): Promise<StopSupervisorResult> {
  const state = readSupervisorState(projectDir)
  if (!state?.pid) {
    clearSupervisorState(projectDir)
    return { stopped: false, reason: "Supervisor is not running" }
  }
  if (!isProcessAlive(state.pid)) {
    clearSupervisorState(projectDir)
    return { stopped: false, reason: "Supervisor has exited (state cleared)" }
  }

  const pid = state.pid
  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    clearSupervisorState(projectDir)
    return { stopped: false, reason: message }
  }

  const deadline = Date.now() + (options?.waitMs ?? 5_000)
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      clearSupervisorState(projectDir)
      return { stopped: true, pid }
    }
    await Bun.sleep(100)
  }

  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // already gone
  }
  await Bun.sleep(200)
  clearSupervisorState(projectDir)
  return { stopped: true, pid, forced: true }
}

export function summarizeRuntimeChannels(state: SupervisorState | undefined, channelIds: ChannelId[]) {
  return channelIds.map((id) => ({
    id,
    runtime: state?.channels?.[id],
  }))
}
