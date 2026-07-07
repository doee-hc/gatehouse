import { loadDomainSkillExtractPrompt } from "../retro/skill-kickoff.ts"
import { loadDomainSkillVerifyPrompt } from "../extract/prompt.ts"
import { createVerifyManifest } from "../extract/verify-setup.ts"
import { loadCuratorSkillAssignKickoff, curatorSkillExtractBatchReadyMessage } from "../curator/prompt.ts"
import { archiveLowUtilitySkills } from "../skills/utility.ts"
import { readExtractManifest, writeVerifyManifest } from "../missions/manifest/store.ts"
import type { MissionExtractManifest, MissionTeamSpec, MissionVerifyManifest } from "../missions/manifest/types.ts"
import { curatorSkillSummaryRelPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import { readAgentNamesSync } from "../names.ts"
import { readLocaleSync } from "../locale.ts"
import { emitPortalEvent } from "../portal/events.ts"
import { spawnIdForAgent } from "../portal/spawn-id.ts"
import {
  extractAgentId,
  verifyAgentId,
  INNER_EXTRACT_AGENT,
  INNER_VERIFY_AGENT,
  type RegistrySkillExtractCompletion,
  type RegistrySkillExtractRun,
  type RegistrySkillVerifyCompletion,
  type RegistrySkillVerifyRun,
} from "./types.ts"
import { now, skillExtractCompletionKey, skillVerifyCompletionKey } from "./helpers.ts"
import type { RegistryHost } from "./internals.ts"
import {
  deactivateExtractAgentForNode,
  deactivateVerifyAgentForNode,
  deactivateVerifyAgentsForMission,
  syncVerifyFromManifest,
} from "./agent-registry.ts"
import { deliverSystemMessage, deliverSystemPrompt } from "./messaging-service.ts"
import { formatDirectedNotification } from "./helpers.ts"

export function beginSkillExtractRun(host: RegistryHost, missionId: string, expectedNodeIds: string[]) {
  return host.mutate(() => {
    for (const key of [...host.state.skillExtractCompletions.keys()]) {
      if (key.startsWith(`${missionId}:`)) host.state.skillExtractCompletions.delete(key)
    }
    const run: RegistrySkillExtractRun = { missionId, expectedNodeIds, startedAt: now() }
    host.state.skillExtractRuns.set(missionId, run)
    return run
  })
}

export function skillExtractStatus(host: RegistryHost, missionId: string) {
  const run = host.state.skillExtractRuns.get(missionId)
  if (!run) return { status: "no_run" as const }
  const completed = run.expectedNodeIds.filter((nodeId) =>
    host.state.skillExtractCompletions.has(skillExtractCompletionKey(missionId, nodeId)),
  )
  const pending = run.expectedNodeIds.filter((nodeId) => !completed.includes(nodeId))
  const completions = completed.flatMap((nodeId) => {
    const item = host.state.skillExtractCompletions.get(skillExtractCompletionKey(missionId, nodeId))
    if (!item) return []
    return [{ node_id: nodeId, summary_path: item.summaryPath, completed_at: item.completedAt }]
  })
  return {
    status: "ok" as const,
    run,
    completed,
    pending,
    completions,
    allDone: pending.length === 0 && run.expectedNodeIds.length > 0,
    verifyStarted: Boolean(run.verifyStartedAt),
    curatorNotified: Boolean(run.curatorNotifiedAt),
    curatorSummarySubmitted: Boolean(run.curatorLeadNotifiedAt),
    curatorLeadNotified: Boolean(run.curatorLeadNotifiedAt),
  }
}

export function beginSkillVerifyRun(host: RegistryHost, missionId: string, expectedNodeIds: string[]) {
  return host.mutate(() => {
    for (const key of [...host.state.skillVerifyCompletions.keys()]) {
      if (key.startsWith(`${missionId}:`)) host.state.skillVerifyCompletions.delete(key)
    }
    const run: RegistrySkillVerifyRun = { missionId, expectedNodeIds, startedAt: now() }
    host.state.skillVerifyRuns.set(missionId, run)
    return run
  })
}

export function skillVerifyStatus(host: RegistryHost, missionId: string) {
  const run = host.state.skillVerifyRuns.get(missionId)
  if (!run) return { status: "no_run" as const }
  const completed = run.expectedNodeIds.filter((nodeId) =>
    host.state.skillVerifyCompletions.has(skillVerifyCompletionKey(missionId, nodeId)),
  )
  const pending = run.expectedNodeIds.filter((nodeId) => !completed.includes(nodeId))
  const completions = completed.flatMap((nodeId) => {
    const item = host.state.skillVerifyCompletions.get(skillVerifyCompletionKey(missionId, nodeId))
    if (!item) return []
    return [{
      node_id: nodeId,
      passed: item.passed,
      report_path: item.reportPath,
      completed_at: item.completedAt,
    }]
  })
  const skillRun = host.state.skillExtractRuns.get(missionId)
  return {
    status: "ok" as const,
    run,
    completed,
    pending,
    completions,
    allDone: pending.length === 0 && run.expectedNodeIds.length > 0,
    curatorNotified: Boolean(skillRun?.curatorNotifiedAt),
  }
}

export function listIncompleteSkillVerifyRecordRuns(host: RegistryHost) {
  return [...host.state.skillVerifyRuns.keys()].flatMap((missionId) => {
    const status = skillVerifyStatus(host, missionId)
    if (status.status !== "ok" || status.allDone) return []
    return [{
      missionId,
      expectedNodeIds: status.run.expectedNodeIds,
      pendingNodeIds: status.pending,
    }]
  })
}

export function listIncompleteSkillExtractRecordRuns(host: RegistryHost) {
  return [...host.state.skillExtractRuns.keys()].flatMap((missionId) => {
    const status = skillExtractStatus(host, missionId)
    if (status.status !== "ok" || status.allDone) return []
    return [{
      missionId,
      expectedNodeIds: status.run.expectedNodeIds,
      pendingNodeIds: status.pending,
    }]
  })
}

export async function recordSkillExtractCompletion(
  host: RegistryHost,
  input: {
    missionId: string
    nodeId: string
    sessionId: string
    summaryPath?: string
  },
) {
  const recorded = host.mutate(() => {
    const item: RegistrySkillExtractCompletion = {
      missionId: input.missionId,
      nodeId: input.nodeId,
      sessionId: input.sessionId,
      completedAt: now(),
      ...(input.summaryPath && { summaryPath: input.summaryPath }),
    }
    host.state.skillExtractCompletions.set(skillExtractCompletionKey(input.missionId, input.nodeId), item)
    return item
  })
  deactivateExtractAgentForNode(host, input.missionId, input.nodeId)
  await maybeKickoffSkillVerify(host, input.missionId)
  return recorded
}

export async function recordSkillVerifyCompletion(
  host: RegistryHost,
  input: {
    missionId: string
    nodeId: string
    sessionId: string
    passed: boolean
    reportPath?: string
  },
) {
  const recorded = host.mutate(() => {
    const item: RegistrySkillVerifyCompletion = {
      missionId: input.missionId,
      nodeId: input.nodeId,
      sessionId: input.sessionId,
      passed: input.passed,
      completedAt: now(),
      ...(input.reportPath && { reportPath: input.reportPath }),
    }
    host.state.skillVerifyCompletions.set(skillVerifyCompletionKey(input.missionId, input.nodeId), item)
    return item
  })
  deactivateVerifyAgentForNode(host, input.missionId, input.nodeId)
  await maybeNotifyCuratorSkillExtractComplete(host, input.missionId)
  const after = skillVerifyStatus(host, input.missionId)
  if (after.status === "ok" && after.allDone) deactivateVerifyAgentsForMission(host, input.missionId)
  return recorded
}

async function maybeKickoffSkillVerify(host: RegistryHost, missionId: string) {
  const status = skillExtractStatus(host, missionId)
  if (status.status !== "ok" || !status.allDone || status.verifyStarted) return

  const extractManifest = await readExtractManifest(host.directory, missionId)
  if (!extractManifest || extractManifest.extract_order.length === 0) return

  const verify = await createVerifyManifest({
    client: host.options.client,
    projectDirectory: host.directory,
    extract: extractManifest,
  })
  await writeVerifyManifest(host.directory, verify)
  syncVerifyFromManifest(host, verify)
  beginSkillVerifyRun(host, missionId, verify.verify_order)
  host.mutate(() => {
    const run = host.state.skillExtractRuns.get(missionId)
    if (!run) return
    host.state.skillExtractRuns.set(missionId, { ...run, verifyStartedAt: now() })
  })
  await kickoffSkillVerifySessions(host, verify)
}

async function maybeNotifyCuratorSkillExtractComplete(host: RegistryHost, missionId: string) {
  const verifyStatus = skillVerifyStatus(host, missionId)
  if (verifyStatus.status !== "ok" || !verifyStatus.allDone) return
  const skillRun = host.state.skillExtractRuns.get(missionId)
  if (!skillRun || skillRun.curatorNotifiedAt) return
  const curator = host.byProfile("curator", "outer")
  if (!curator?.sessionId) return
  const extractStatus = skillExtractStatus(host, missionId)
  const completions = extractStatus.status === "ok"
    ? extractStatus.completed.map((nodeId) => {
        const item = host.state.skillExtractCompletions.get(skillExtractCompletionKey(missionId, nodeId))
        return { nodeId, summaryPath: item?.summaryPath ?? curatorSkillSummaryRelPath(missionId, nodeId) }
      })
    : []
  await archiveLowUtilitySkills(host.directory)
  const sent = await deliverSystemMessage(
    host,
    curator,
    curatorSkillExtractBatchReadyMessage(
      missionId,
      completions,
      readAgentNamesSync(host.directory),
      readLocaleSync(host.directory),
    ),
  )
  if (sent.status === "failed") return
  host.mutate(() => {
    const run = host.state.skillExtractRuns.get(missionId)
    if (!run) return
    host.state.skillExtractRuns.set(missionId, { ...run, curatorNotifiedAt: now() })
  })
}

export async function kickoffCuratorSkillAssignment(
  host: RegistryHost,
  input: { missionId: string; objective?: string; spec: MissionTeamSpec },
) {
  const curator = host.byProfile("curator", "outer")
  if (!curator?.sessionId) {
    return {
      delivery: "failed" as const,
      error: "curator session not registered; lead must call gatehouse_init_team first",
    }
  }
  const promptText = formatDirectedNotification(
    host.directory,
    "Gatehouse",
    await loadCuratorSkillAssignKickoff(host.directory, {
      missionId: input.missionId,
      objective: input.objective,
      spec: input.spec,
    }),
  )
  const result = await deliverSystemPrompt(host, curator, promptText, { promptProfile: curator.profile })
  if (result.status !== "failed") {
    const architect = host.byProfile("architect", "outer")
    if (architect) {
      const locale = readLocaleSync(host.directory)
      emitPortalEvent({
        type: "agent.chat",
        fromSpawnId: spawnIdForAgent(architect),
        toSpawnId: spawnIdForAgent(curator),
        text: gatehouseMessage("portal.architectBootstrapCuratorHint", locale),
      })
    }
  }
  return {
    curator_session_id: curator.sessionId,
    delivery: result.status,
    ...(result.error && { error: result.error }),
  }
}

export async function kickoffExtractSkillSessions(host: RegistryHost, extract: MissionExtractManifest) {
  beginSkillExtractRun(host, extract.mission_id, extract.extract_order)
  const deliveries: Array<{ nodeId: string; skillDomain: string; delivery: "sent" | "queued" | "failed"; error?: string }> = []
  for (const nodeId of extract.extract_order) {
    const extractNode = extract.nodes[nodeId]
    if (!extractNode) continue
    const recipient = host.byAgentId(extractAgentId(extract.mission_id, nodeId))
    if (!recipient) {
      deliveries.push({
        nodeId,
        skillDomain: extractNode.skill_domain,
        delivery: "failed",
        error: "extract agent not in registry",
      })
      continue
    }
    const content = await loadDomainSkillExtractPrompt(host.directory, {
      missionId: extract.mission_id,
      nodeId,
      skillDomain: extractNode.skill_domain,
    })
    const result = await deliverSystemMessage(host, recipient, content, INNER_EXTRACT_AGENT)
    deliveries.push({
      nodeId,
      skillDomain: extractNode.skill_domain,
      delivery: result.status,
      ...(result.error && { error: result.error }),
    })
  }
  return deliveries
}

export async function kickoffSkillVerifySessions(host: RegistryHost, verify: MissionVerifyManifest) {
  const deliveries: Array<{ nodeId: string; skillDomain: string; delivery: "sent" | "queued" | "failed"; error?: string }> = []
  for (const nodeId of verify.verify_order) {
    const verifyNode = verify.nodes[nodeId]
    if (!verifyNode) continue
    const recipient = host.byAgentId(verifyAgentId(verify.mission_id, nodeId))
    if (!recipient) {
      deliveries.push({
        nodeId,
        skillDomain: verifyNode.skill_domain,
        delivery: "failed",
        error: "verify agent not in registry",
      })
      continue
    }
    const content = await loadDomainSkillVerifyPrompt(host.directory, {
      missionId: verify.mission_id,
      nodeId,
      skillDomain: verifyNode.skill_domain,
    })
    const result = await deliverSystemMessage(host, recipient, content, INNER_VERIFY_AGENT)
    deliveries.push({
      nodeId,
      skillDomain: verifyNode.skill_domain,
      delivery: result.status,
      ...(result.error && { error: result.error }),
    })
  }
  return deliveries
}
