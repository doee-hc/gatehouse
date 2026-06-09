import fs from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "../paths.ts"
import { readJsonFile, writeJsonFile } from "../store/files.ts"
import type { ChannelId } from "./types.ts"

export type SupervisorControlAction = "start_channel" | "stop_channel"

export type SupervisorControlCommand = {
  id: string
  action: SupervisorControlAction
  channelId: ChannelId
  at: number
}

export function supervisorControlPath(projectDir: string) {
  return path.join(resolveChannelStateDir(projectDir, "supervisor"), "control.json")
}

export function enqueueSupervisorControl(
  projectDir: string,
  action: SupervisorControlAction,
  channelId: ChannelId,
) {
  const command: SupervisorControlCommand = {
    id: crypto.randomUUID(),
    action,
    channelId,
    at: Date.now(),
  }
  writeJsonFile(supervisorControlPath(projectDir), command)
  return command
}

export function consumeSupervisorControl(projectDir: string): SupervisorControlCommand | undefined {
  const file = supervisorControlPath(projectDir)
  if (!fs.existsSync(file)) return undefined
  const command = readJsonFile<SupervisorControlCommand>(file)
  if (!command?.action || !command.channelId) {
    fs.unlinkSync(file)
    return undefined
  }
  fs.unlinkSync(file)
  return command
}
