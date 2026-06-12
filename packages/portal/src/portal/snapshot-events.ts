import type { BlogPost, BlogSnapshot, PortalAgent, PortalSnapshot } from "../api/types.ts"
import { clearEventLogPlaceholder, logEvent } from "../shell/event-log.ts"
import { t } from "../shell/i18n.ts"
import { shouldLogAgentStatus } from "./status-log.ts"

function missionTree(snapshot: PortalSnapshot | undefined, missionId: string | undefined) {
  if (!snapshot || !missionId) return undefined
  if (snapshot.tree?.mission_id === missionId) return snapshot.tree
  return snapshot.trees?.find((tree) => tree.mission_id === missionId)
}

function nodeLabel(snapshot: PortalSnapshot, missionId: string | undefined, nodeId: string) {
  const tree = missionTree(snapshot, missionId)
  const node = tree?.nodes.find((entry) => entry.node_id === nodeId)
  return node?.display_name || nodeId
}

function logAgentStatusEvent(agent: PortalAgent) {
  if (!shouldLogAgentStatus(agent.spawn_id, agent.status)) return
  clearEventLogPlaceholder()
  const name = agent.display_name
  if (agent.status === "research") {
    logEvent(() => t("event.sessionResearch", { name }), "evt-busy")
    return
  }
  if (agent.status === "busy") {
    logEvent(() => t("event.sessionBusy", { name }), "evt-busy")
    return
  }
  logEvent(() => t("event.sessionIdle", { name }), "evt-msg")
}

export function logSnapshotDiff(prev: PortalSnapshot | undefined, next: PortalSnapshot) {
  if (!prev) return

  logMissionEvents(prev, next)
  logAgentRosterEvents(prev, next)
  logRetroEvents(prev, next)
  logOfficeLayoutEvents(prev, next)
  logSkillEvents(prev, next)

  for (const agent of next.agents) {
    const before = prev.agents.find((item) => item.spawn_id === agent.spawn_id)
    if (before && before.status !== agent.status) logAgentStatusEvent(agent)
  }
}

function logMissionEvents(prev: PortalSnapshot, next: PortalSnapshot) {
  const startedMissions = new Set<string>()

  for (const mission of next.missions) {
    const before = prev.missions.find((item) => item.id === mission.id)
    if (!before || before.status === mission.status) continue

    if (mission.status === "running") {
      startedMissions.add(mission.id)
      logEvent(() => t("event.missionStarted", { id: mission.id }), "evt-live")
      continue
    }
    if (mission.status === "retro") {
      logEvent(() => t("event.missionRetro", { id: mission.id }), "evt-busy")
      continue
    }
    if (mission.status === "done") {
      logEvent(() => t("event.missionDone", { id: mission.id }), "evt-msg")
      continue
    }
    if (mission.status === "cancelled") {
      logEvent(() => t("event.missionCancelled", { id: mission.id }), "evt-warn")
    }
  }

  const nextActiveMissionId = next.active_mission_id
  if (
    nextActiveMissionId &&
    prev.active_mission_id &&
    nextActiveMissionId !== prev.active_mission_id &&
    !startedMissions.has(nextActiveMissionId)
  ) {
    logEvent(() => t("event.activeMissionChanged", { id: nextActiveMissionId }), "evt-live")
  }

  const lingeringMissionId = next.lingering_mission_id
  if (lingeringMissionId && lingeringMissionId !== prev.lingering_mission_id) {
    logEvent(() => t("event.missionLingering", { id: lingeringMissionId }), "evt-msg")
  }

  const activeId = next.active_mission_id
  const prevTree = missionTree(prev, activeId)
  const nextTree = missionTree(next, activeId)
  if (activeId && !prevTree && nextTree && nextTree.nodes.length > 0) {
    logEvent(() => t("event.treeBootstrapped", { id: activeId, count: String(nextTree.nodes.length) }), "evt-live")
  }
}

function logAgentRosterEvents(prev: PortalSnapshot, next: PortalSnapshot) {
  const prevSpawns = new Set(prev.agents.map((agent) => agent.spawn_id))
  const nextSpawns = new Set(next.agents.map((agent) => agent.spawn_id))

  for (const agent of next.agents) {
    if (prevSpawns.has(agent.spawn_id)) continue
    if (agent.scope === "retro") {
      logEvent(() => t("event.agentRetroJoined", { name: agent.display_name }), "evt-busy")
      continue
    }
    if (agent.scope === "inner") {
      logEvent(() => t("event.agentJoined", { name: agent.display_name }), "evt-live")
    }
  }

  for (const agent of prev.agents) {
    if (nextSpawns.has(agent.spawn_id)) continue
    if (agent.scope === "retro") {
      logEvent(() => t("event.agentRetroLeft", { name: agent.display_name }), "evt-msg")
      continue
    }
    if (agent.scope === "inner" || agent.lingering) {
      logEvent(() => t("event.agentLeft", { name: agent.display_name }), "evt-msg")
    }
  }
}

function logRetroEvents(prev: PortalSnapshot, next: PortalSnapshot) {
  const prevRetro = prev.retro
  const nextRetro = next.retro

  if (!prevRetro && nextRetro?.active) {
    logEvent(() => t("event.retroKickoff", { id: nextRetro.mission_id }), "evt-busy")
  }

  const prevCompleted = new Set(prevRetro?.completed_node_ids ?? [])
  for (const nodeId of nextRetro?.completed_node_ids ?? []) {
    if (prevCompleted.has(nodeId)) continue
    const label = nodeLabel(next, nextRetro?.mission_id, nodeId)
    logEvent(() => t("event.retroNodeDone", { node: label }), "evt-msg")
  }

  if (nextRetro?.all_done && !prevRetro?.all_done) {
    logEvent(() => t("event.retroAllDone", { id: nextRetro.mission_id }), "evt-live")
  }
}

function logOfficeLayoutEvents(prev: PortalSnapshot, next: PortalSnapshot) {
  const prevLayout = prev.office_layout
  const nextLayout = next.office_layout
  if (!nextLayout) return

  const renovationStarted =
    !nextLayout.ready &&
    (!prevLayout || prevLayout.ready || prevLayout.revision !== nextLayout.revision)
  if (renovationStarted) {
    logEvent(() => t("event.officeRenovationStart"), "evt-warn")
  }

  const renovationDone =
    nextLayout.ready && (!prevLayout?.ready || prevLayout.revision !== nextLayout.revision)
  if (renovationDone) {
    logEvent(
      () => t("event.officeRenovationDone", { count: String(nextLayout.workstation_count) }),
      "evt-live",
    )
  }
}

function logSkillEvents(prev: PortalSnapshot, next: PortalSnapshot) {
  const prevPaths = new Set(prev.skills.map((skill) => skill.path))
  for (const skill of next.skills) {
    if (prevPaths.has(skill.path)) continue
    logEvent(() => t("event.skillArchived", { name: skill.name, domain: skill.domain }), "evt-msg")
  }
}

function blogPosts(snapshot: BlogSnapshot | undefined) {
  if (!snapshot) return [] as BlogPost[]
  return snapshot.groups.flatMap((group) => group.posts)
}

const loggedBlogPublish = new Set<string>()
const loggedBlogUnpublish = new Set<string>()

function noteBlogEvent(kind: "publish" | "unpublish", postId: string) {
  const seen = kind === "publish" ? loggedBlogPublish : loggedBlogUnpublish
  const opposite = kind === "publish" ? loggedBlogUnpublish : loggedBlogPublish
  if (seen.has(postId)) return false
  seen.add(postId)
  opposite.delete(postId)
  return true
}

export function logBlogPublishedEvent(postId: string, title: string) {
  if (!noteBlogEvent("publish", postId)) return
  logEvent(() => t("event.blogPublished", { title }), "evt-msg")
}

export function logBlogUnpublishedEvent(postId: string, title: string) {
  if (!noteBlogEvent("unpublish", postId)) return
  logEvent(() => t("event.blogUnpublished", { title }), "evt-warn")
}

export function logBlogSnapshotDiff(prev: BlogSnapshot | undefined, next: BlogSnapshot) {
  if (!prev) return

  const prevIds = new Map(blogPosts(prev).map((post) => [post.id, post]))
  const nextIds = new Map(blogPosts(next).map((post) => [post.id, post]))

  for (const [id, post] of nextIds) {
    if (prevIds.has(id)) continue
    logBlogPublishedEvent(id, post.title)
  }

  for (const [id, post] of prevIds) {
    if (nextIds.has(id)) continue
    logBlogUnpublishedEvent(id, post.title)
  }
}

export function resetPortalEventDedupeForTests() {
  loggedBlogPublish.clear()
  loggedBlogUnpublish.clear()
}
