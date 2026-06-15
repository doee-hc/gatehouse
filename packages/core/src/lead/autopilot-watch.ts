import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

export type AutopilotWatchState = {
  awaiting_since?: number
  last_wake_at?: number
  last_assistant_message_id?: string
  /** Dedup key for autopilot+direction enabled notice delivered to lead. */
  enabled_notify_key?: string
}

export function autopilotWatchStatePath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "lead", "autopilot-watch.yaml")
}

function parseWatchState(raw: unknown): AutopilotWatchState {
  if (!isRecord(raw)) return {}
  return {
    ...(typeof raw.awaiting_since === "number" && { awaiting_since: raw.awaiting_since }),
    ...(typeof raw.last_wake_at === "number" && { last_wake_at: raw.last_wake_at }),
    ...(readString(raw.last_assistant_message_id) && {
      last_assistant_message_id: readString(raw.last_assistant_message_id),
    }),
    ...(readString(raw.enabled_notify_key) && {
      enabled_notify_key: readString(raw.enabled_notify_key),
    }),
  }
}

export async function readAutopilotWatchState(projectDirectory: string): Promise<AutopilotWatchState> {
  const file = Bun.file(autopilotWatchStatePath(projectDirectory))
  if (!(await file.exists())) return {}
  return parseWatchState(parseYaml(await file.text()))
}

export async function writeAutopilotWatchState(projectDirectory: string, state: AutopilotWatchState) {
  const filePath = autopilotWatchStatePath(projectDirectory)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  const payload = Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined && value !== null),
  )
  if (Object.keys(payload).length === 0) {
    const file = Bun.file(filePath)
    if (await file.exists()) await file.delete()
    return
  }
  await Bun.write(filePath, Bun.YAML.stringify(payload))
}

/** Reset idle/wake tracking; keep enabled-notice dedup so watchdog does not resend. */
export async function clearAutopilotWatchState(projectDirectory: string) {
  const state = await readAutopilotWatchState(projectDirectory)
  const preserved: AutopilotWatchState = state.enabled_notify_key
    ? { enabled_notify_key: state.enabled_notify_key }
    : {}
  await writeAutopilotWatchState(projectDirectory, preserved)
}
