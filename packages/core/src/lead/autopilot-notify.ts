import type { RegistryStore } from "../registry/store.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import type { AutopilotDocument } from "./autopilot.ts"
import { readAutopilotDocument, autopilotIsEnabled } from "./autopilot.ts"
import type { DirectionDocument } from "./direction.ts"
import { readDirectionDocument, directionIsConfirmed } from "./direction.ts"
import { readAutopilotWatchState, writeAutopilotWatchState } from "./autopilot-watch.ts"
import { loadAutopilotEnabledPrompt } from "../watchdog/prompt.ts"

export function autopilotEnabledNotifyKey(autopilot: AutopilotDocument, direction: DirectionDocument) {
  return `${autopilot.enabled_at ?? ""}|${direction.confirmed_at ?? ""}`
}

export async function maybeDeliverAutopilotEnabledNotice(input: {
  projectDirectory: string
  registry: RegistryStore
}) {
  const { projectDirectory, registry } = input
  const autopilot = await readAutopilotDocument(projectDirectory)
  if (!autopilotIsEnabled(autopilot)) {
    return { action: "autopilot_off" as const }
  }

  const direction = await readDirectionDocument(projectDirectory)
  if (!directionIsConfirmed(direction)) {
    return { action: "direction_not_confirmed" as const }
  }

  const notifyKey = autopilotEnabledNotifyKey(autopilot, direction)
  const state = await readAutopilotWatchState(projectDirectory)
  if (state.enabled_notify_key === notifyKey) {
    return { action: "already_notified" as const }
  }

  const lead = registry.byProfile(LEAD_OPENCODE, "outer")
  if (!lead?.sessionId) return { action: "no_lead" as const }

  const content = await loadAutopilotEnabledPrompt(projectDirectory)
  const delivered = await registry.deliverSystemMessage(lead, content, lead.profile)
  if (delivered.status === "failed") {
    return { action: "notify_failed" as const }
  }

  await writeAutopilotWatchState(projectDirectory, {
    ...state,
    enabled_notify_key: notifyKey,
  })

  return { action: "notified" as const }
}
