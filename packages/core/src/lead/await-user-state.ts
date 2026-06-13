import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

export type LeadAwaitPhase = "pre_start" | "acceptance" | "post_retro"

export type LeadAwaitUserState = {
  phase?: LeadAwaitPhase
  mission_id?: string
  /** pre_start: set by gatehouse_lead_await_user */
  armed?: boolean
  awaiting_since?: number
  last_wake_at?: number
  last_assistant_message_id?: string
}

export function leadAwaitUserStatePath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "lead", "await-user.yaml")
}

function parseState(raw: unknown): LeadAwaitUserState {
  if (!isRecord(raw)) return {}
  const phase = readString(raw.phase)
  const parsedPhase =
    phase === "pre_start" || phase === "acceptance" || phase === "post_retro" ? phase : undefined
  return {
    ...(parsedPhase && { phase: parsedPhase }),
    ...(readString(raw.mission_id) && { mission_id: readString(raw.mission_id) }),
    ...(raw.armed === true && { armed: true }),
    ...(typeof raw.awaiting_since === "number" && { awaiting_since: raw.awaiting_since }),
    ...(typeof raw.last_wake_at === "number" && { last_wake_at: raw.last_wake_at }),
    ...(readString(raw.last_assistant_message_id) && {
      last_assistant_message_id: readString(raw.last_assistant_message_id),
    }),
  }
}

export async function readLeadAwaitUserState(projectDirectory: string): Promise<LeadAwaitUserState> {
  const file = Bun.file(leadAwaitUserStatePath(projectDirectory))
  if (!(await file.exists())) return {}
  return parseState(parseYaml(await file.text()))
}

export async function writeLeadAwaitUserState(projectDirectory: string, state: LeadAwaitUserState) {
  const filePath = leadAwaitUserStatePath(projectDirectory)
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

export async function clearLeadAwaitUserState(projectDirectory: string) {
  await writeLeadAwaitUserState(projectDirectory, {})
}

export async function armLeadAwaitUser(input: {
  projectDirectory: string
  phase: LeadAwaitPhase
  missionId: string
}) {
  await writeLeadAwaitUserState(input.projectDirectory, {
    phase: input.phase,
    mission_id: input.missionId,
    ...(input.phase === "pre_start" ? { armed: true } : {}),
  })
}
