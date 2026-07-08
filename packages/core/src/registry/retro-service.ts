import {
  publishArchitectSummaryBlogPost,
  publishRetroSummaryBlogPost,
} from "../delivery/publish-artifacts.ts"
import { architectRetroReviewReadyMessage, leadRetroSummaryReadyMessage, loadRetroKickoffPrompt } from "../retro/prompt.ts"
import { architectSummaryRelPath, curatorSummaryRelPath } from "../paths.ts"
import { readAgentNamesSync } from "../names.ts"
import { readLocaleSync } from "../locale.ts"
import type { MissionManifest } from "../missions/manifest/types.ts"
import type { OrchestrationPlan } from "../orchestration/plan/types.ts"
import { retroAgentId, type RegistryRetroRun } from "./types.ts"
import { now } from "./helpers.ts"
import type { RegistryHost } from "./internals.ts"
import { deactivateRetroAgent } from "./agent-registry.ts"
import { deliverSystemMessage, deliverSystemPrompt, flushPendingDeliveries } from "./messaging-service.ts"
import { skillExtractStatus, skillVerifyStatus } from "./extract-service.ts"

export function beginRetroRun(host: RegistryHost, missionId: string) {
  return host.mutate(() => {
    const run: RegistryRetroRun = { missionId, startedAt: now() }
    host.state.retroRuns.set(missionId, run)
    return run
  })
}

export function retroStatus(host: RegistryHost, missionId: string) {
  const run = host.state.retroRuns.get(missionId)
  if (!run) return { status: "no_run" as const }
  const summarySubmitted = Boolean(run.retroSummarySubmittedAt)
  return {
    status: "ok" as const,
    run,
    summarySubmitted,
    architectNotified: Boolean(run.architectNotifiedAt),
    architectSummarySubmitted: Boolean(run.architectLeadNotifiedAt),
    architectLeadNotified: Boolean(run.architectLeadNotifiedAt),
    leadRetroSummaryNotified: Boolean(run.leadRetroSummaryNotifiedAt),
  }
}

export function retroCompleteReadiness(host: RegistryHost, missionId: string) {
  const pending: string[] = []
  const retro = retroStatus(host, missionId)
  if (retro.status === "no_run") {
    return { ready: true, pending, retro, skill: skillExtractStatus(host, missionId) }
  }
  if (!retro.summarySubmitted) pending.push("retro_analyst_summary")
  else if (!retro.architectSummarySubmitted) pending.push("architect_retro_summary")

  const skill = skillExtractStatus(host, missionId)
  if (skill.status === "ok" && skill.run.expectedNodeIds.length > 0) {
    if (!skill.allDone) pending.push("skill_extract_nodes")
    else {
      const verify = skillVerifyStatus(host, missionId)
      if (verify.status === "no_run" || !verify.allDone) pending.push("skill_verify_nodes")
      else if (!skill.curatorSummarySubmitted) pending.push("curator_skill_summary")
    }
  }

  return { ready: pending.length === 0, pending, retro, skill }
}

export async function recordArchitectRetroSummary(host: RegistryHost, input: { missionId: string; reportPath: string }) {
  const retro = retroStatus(host, input.missionId)
  if (retro.status !== "ok") {
    throw new Error(`No retro run for mission ${input.missionId}`)
  }
  if (!retro.summarySubmitted) {
    throw new Error(`Mission ${input.missionId} retro-summary has not been submitted yet`)
  }
  const alreadySubmitted = retro.architectSummarySubmitted
  if (!alreadySubmitted) {
    host.mutate(() => {
      const run = host.state.retroRuns.get(input.missionId)
      if (!run) return
      host.state.retroRuns.set(input.missionId, { ...run, architectLeadNotifiedAt: now() })
    })
  }
  const leadDelivery = await maybeNotifyLeadRetroSummaryComplete(host, input.missionId)
  await publishArchitectSummaryBlogPost(host.directory, input.missionId, input.reportPath).catch(
    () => undefined,
  )
  return {
    missionId: input.missionId,
    reportPath: input.reportPath,
    alreadySubmitted,
    retro_status: retroStatus(host, input.missionId),
    retro_readiness: retroCompleteReadiness(host, input.missionId),
    lead_notification: leadDelivery,
  }
}

export async function recordCuratorSkillSummary(host: RegistryHost, input: { missionId: string; reportPath: string }) {
  const skill = skillExtractStatus(host, input.missionId)
  if (skill.status !== "ok" || skill.run.expectedNodeIds.length === 0) {
    throw new Error(`Mission ${input.missionId} has no skill extract pipeline for curator`)
  }
  const verify = skillVerifyStatus(host, input.missionId)
  if (verify.status !== "ok" || !verify.allDone) {
    throw new Error(`Mission ${input.missionId} skill verify pipeline is not complete yet`)
  }
  const alreadySubmitted = skill.curatorSummarySubmitted
  if (!alreadySubmitted) {
    host.mutate(() => {
      const run = host.state.skillExtractRuns.get(input.missionId)
      if (!run) return
      host.state.skillExtractRuns.set(input.missionId, { ...run, curatorLeadNotifiedAt: now() })
    })
  }
  const leadDelivery = await maybeNotifyLeadRetroSummaryComplete(host, input.missionId)
  return {
    missionId: input.missionId,
    reportPath: input.reportPath,
    alreadySubmitted,
    skill_status: skillExtractStatus(host, input.missionId),
    retro_readiness: retroCompleteReadiness(host, input.missionId),
    lead_notification: leadDelivery,
  }
}

async function maybeNotifyLeadRetroSummaryComplete(host: RegistryHost, missionId: string) {
  const readiness = retroCompleteReadiness(host, missionId)
  if (!readiness.ready) return { status: "skipped" as const, reason: "retro_incomplete" as const }

  const run = host.state.retroRuns.get(missionId)
  if (run?.leadRetroSummaryNotifiedAt) {
    return { status: "skipped" as const, reason: "already_notified" as const }
  }

  const lead = host.byProfile("lead", "outer")
  if (!lead?.sessionId) {
    return { status: "failed" as const, error: "lead session not registered" }
  }

  const locale = readLocaleSync(host.directory)
  const names = readAgentNamesSync(host.directory)
  const skillAssigned =
    readiness.skill.status === "ok" && readiness.skill.run.expectedNodeIds.length > 0
  const sent = await deliverSystemMessage(
    host,
    lead,
    leadRetroSummaryReadyMessage(missionId, {
      architectSummaryPath: architectSummaryRelPath(missionId),
      ...(skillAssigned && { curatorSummaryPath: curatorSummaryRelPath(missionId) }),
      locale,
      leadName: names.lead,
    }),
    lead.profile,
  )
  if (sent.status === "failed") {
    return { status: "failed" as const, error: sent.error ?? "prompt failed" }
  }

  host.mutate(() => {
    const current = host.state.retroRuns.get(missionId)
    if (!current) return
    host.state.retroRuns.set(missionId, { ...current, leadRetroSummaryNotifiedAt: now() })
  })
  await flushPendingDeliveries(host)
  return { status: sent.status, session_id: lead.sessionId }
}

export async function recordRetroSummary(
  host: RegistryHost,
  input: { missionId: string; sessionId: string; reportPath: string },
) {
  const recorded = host.mutate(() => {
    const run = host.state.retroRuns.get(input.missionId)
    if (!run) throw new Error(`No retro run for mission ${input.missionId}`)
    const updated: RegistryRetroRun = {
      ...run,
      retroSummarySubmittedAt: now(),
      retroSummaryPath: input.reportPath,
    }
    host.state.retroRuns.set(input.missionId, updated)
    return updated
  })
  deactivateRetroAgent(host, input.missionId)
  await maybeNotifyArchitectRetroReview(host, input.missionId, input.reportPath)
  await publishRetroSummaryBlogPost(host.directory, input.missionId, input.reportPath).catch(
    () => undefined,
  )
  return recorded
}

export async function kickoffRetroSession(host: RegistryHost, manifest: MissionManifest, plan?: OrchestrationPlan) {
  const recipient = host.byAgentId(retroAgentId(manifest.mission_id))
  if (!recipient) {
    return { delivery: "failed" as const, error: "retro analyst not in registry" }
  }
  const promptText = await loadRetroKickoffPrompt(host.directory, {
    missionId: manifest.mission_id,
    manifest,
    plan,
  })
  const result = await deliverSystemPrompt(host, recipient, promptText, { promptProfile: recipient.profile })
  return {
    nodeId: manifest.mission_id,
    delivery: result.status,
    ...(result.error && { error: result.error }),
  }
}

async function maybeNotifyArchitectRetroReview(host: RegistryHost, missionId: string, reportPath: string) {
  const status = retroStatus(host, missionId)
  if (status.status !== "ok" || !status.summarySubmitted || status.architectNotified) return
  const architect = host.byProfile("architect", "outer")
  if (!architect) return
  const sent = await deliverSystemMessage(
    host,
    architect,
    architectRetroReviewReadyMessage(
      missionId,
      reportPath,
      readAgentNamesSync(host.directory),
      readLocaleSync(host.directory),
    ),
  )
  if (sent.status === "failed") return
  host.mutate(() => {
    const run = host.state.retroRuns.get(missionId)
    if (!run) return
    host.state.retroRuns.set(missionId, { ...run, architectNotifiedAt: now() })
  })
}

export function listIncompleteRetroRecordRuns(host: RegistryHost) {
  return [...host.state.retroRuns.keys()].flatMap((missionId) => {
    const status = retroStatus(host, missionId)
    if (status.status !== "ok" || status.summarySubmitted) return []
    return [{
      missionId,
      expectedNodeIds: ["retro-analyst"],
      pendingNodeIds: ["retro-analyst"],
    }]
  })
}
