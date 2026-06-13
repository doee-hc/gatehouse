import type { RegistryStore } from "../registry/store.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { retroMissionIds, runningMissionIds } from "../missions/parse.ts"
import { deliveryIsFinalized, deliveryIsSubmitted, readDeliveryDocument } from "../delivery/store.ts"
import type { LeadAwaitPhase } from "./await-user-state.ts"

export type LeadAwaitContext = {
  phase: LeadAwaitPhase
  missionId: string
  requiresArm: boolean
}

export async function resolveLeadAwaitContext(input: {
  projectDirectory: string
  registry: RegistryStore
  armedPreStartMissionId?: string
}): Promise<LeadAwaitContext | null> {
  const doc = await readMissionsDocument(input.projectDirectory)
  const running = runningMissionIds(doc)
  if (running.length > 0) {
    const missionId = running[0]!
    const delivery = await readDeliveryDocument(input.projectDirectory, missionId)
    if (deliveryIsSubmitted(delivery) && !deliveryIsFinalized(delivery)) {
      return { phase: "acceptance", missionId, requiresArm: false }
    }
    return null
  }

  const retro = retroMissionIds(doc)
  if (retro.length > 0) {
    const missionId = retro[0]!
    const readiness = input.registry.retroCompleteReadiness(missionId)
    if (readiness.ready) {
      return { phase: "post_retro", missionId, requiresArm: false }
    }
    return null
  }

  if (input.armedPreStartMissionId) {
    const queued = doc.missions.find(
      (mission) => mission.id === input.armedPreStartMissionId && mission.status === "queued",
    )
    if (queued) {
      return { phase: "pre_start", missionId: queued.id, requiresArm: true }
    }
  }

  return null
}

export function leadAwaitContextMatchesState(
  ctx: LeadAwaitContext,
  state: { phase?: LeadAwaitPhase; mission_id?: string; armed?: boolean },
) {
  if (state.phase !== ctx.phase) return false
  if (state.mission_id && state.mission_id !== ctx.missionId) return false
  if (ctx.requiresArm && !state.armed) return false
  return true
}
