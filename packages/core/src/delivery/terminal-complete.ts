import type { PluginInput } from "@opencode-ai/plugin"
import { formatLeadDeliveryNotification } from "./notify.ts"
import { submitDeliveryRecord } from "./store.ts"
import type { DeliveryEvidence } from "./types.ts"
import { readActiveMissionContract } from "../missions/contract.ts"
import { readMissionsDocument } from "../missions/store.ts"
import { synthesizeTerminalDeliveryMarkdown } from "../orchestration/engine/completion.ts"
import { readOrchestrationState } from "../orchestration/state/store.ts"
import { readLocaleSync } from "../locale.ts"
import { LEAD_OPENCODE } from "../registry/types.ts"
import type { RegistryStore } from "../registry/store.ts"
import { RegistryDatabase } from "../registry/db.ts"
import { notifyWatchdogDeliveryEvent } from "../watchdog/notify.ts"

export async function submitDeliveryOnTerminalComplete(input: {
  plugin: PluginInput
  store: RegistryStore
  missionId: string
  nodeId: string
  summary: string
  senderSessionId: string
  senderProfile?: string
  senderAgentId: string
  forceReason?: string
  evidence?: DeliveryEvidence[]
}) {
  const missionsDoc = await readMissionsDocument(input.plugin.directory)
  const mission = missionsDoc.missions.find((entry) => entry.id === input.missionId)
  if (!mission) {
    throw new Error(`Mission not found in missions.yaml: ${input.missionId}`)
  }
  if (mission.status !== "running") {
    throw new Error(`Mission ${input.missionId} must be running to deliver (current: ${mission.status})`)
  }

  const submitted = await submitDeliveryRecord({
    projectDirectory: input.plugin.directory,
    missionId: input.missionId,
    submittedByNode: input.nodeId,
    summary: input.summary,
    forceReason: input.forceReason,
    evidence: input.evidence,
    missionEntry: mission,
  })

  const orchState = readOrchestrationState(input.plugin.directory, input.missionId)
  const registryDb = new RegistryDatabase(input.plugin.directory, { readonly: true })
  const script = registryDb.getMissionScript(input.missionId)
  const team = script?.team
  const plan = registryDb.getLatestOrchestrationPlan(input.missionId)
  const aggregatedSummaryText =
    orchState && team && plan
      ? synthesizeTerminalDeliveryMarkdown(
          readLocaleSync(input.plugin.directory),
          input.missionId,
          input.nodeId,
          orchState,
          team,
          plan,
        ).trim()
      : input.summary.trim()

  const contract = readActiveMissionContract(input.plugin.directory, input.missionId)
  const lead = input.store.byProfile(LEAD_OPENCODE, "outer")
  if (!lead) {
    throw new Error("Lead not in registry; cannot notify acceptance")
  }

  const message = formatLeadDeliveryNotification(input.plugin.directory, {
    missionId: input.missionId,
    record: submitted.record,
    contract,
    summary: input.summary,
    aggregatedSummaryText,
  })

  const notify = await input.store.deliverSystemNotification({
    senderSessionId: input.senderSessionId,
    senderAgentId: input.senderAgentId,
    recipientQuery: "lead",
    message,
  })
  if (notify.status === "failed") {
    throw new Error(notify.error ?? "failed to notify lead")
  }

  notifyWatchdogDeliveryEvent(input.plugin.directory, { missionId: input.missionId, kind: "submitted" })
  await input.store.flushPendingDeliveries()

  return {
    record: submitted.record,
    relPath: submitted.relPath,
    lead_delivery: notify.status,
    aggregatedSummaryText,
  }
}
