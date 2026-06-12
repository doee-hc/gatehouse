import { mkdir } from "node:fs/promises"
import path from "node:path"
import { deliveryDocumentPath, deliveryDocumentRelPath } from "../paths.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"
import type { MissionEntry } from "../missions/parse.ts"
import {
  criteriaFromMissionEntry,
  precheckHasUnmet,
  readMissionRawDoneWhen,
  runDeliveryPrecheck,
} from "./criteria.ts"
import { pendingMissionPublishPaths, publishMissionDeliverables } from "./publish-artifacts.ts"
import { publishPathsFromCriteria } from "./publish-policy.ts"
import type {
  DeliveryDocument,
  DeliveryEvidence,
  DeliveryRecord,
  DeliveryReview,
  ReviewDecision,
} from "./types.ts"
import { DELIVERY_SCHEMA_VERSION, MAX_DELIVERY_VERSIONS } from "./types.ts"

function parseCheck(raw: unknown) {
  if (!isRecord(raw)) return { kind: "manual" as const }
  const kind = readString(raw.kind)
  if (kind === "path_exists") {
    const filePath = readString(raw.path)
    if (filePath) return { kind: "path_exists" as const, path: filePath }
  }
  if (kind === "command") {
    const cmd = readString(raw.cmd)
    if (cmd) {
      return {
        kind: "command" as const,
        cmd,
        ...(typeof raw.expect_exit === "number" && { expect_exit: raw.expect_exit }),
      }
    }
  }
  return { kind: "manual" as const }
}

function parseCriterion(raw: unknown): DeliveryRecord["criteria"][number] | undefined {
  if (!isRecord(raw)) return undefined
  const id = typeof raw.id === "number" ? raw.id : undefined
  const text = readString(raw.text)
  if (id === undefined || !text) return undefined
  const publishPath = readString(raw.publishPath) ?? readString(raw.publish_path)
  return {
    id,
    text,
    check: parseCheck(raw.check),
    ...(publishPath && { publishPath }),
  }
}

function parseEvidence(raw: unknown): DeliveryEvidence | undefined {
  if (!isRecord(raw)) return undefined
  const criterion_id = typeof raw.criterion_id === "number" ? raw.criterion_id : undefined
  const status = readString(raw.status)
  if (criterion_id === undefined || !status) return undefined
  if (!["met", "unmet", "partial", "skipped"].includes(status)) return undefined
  return {
    criterion_id,
    status: status as DeliveryEvidence["status"],
    ...(readString(raw.proof) && { proof: readString(raw.proof) }),
  }
}

function parsePrecheck(raw: unknown): DeliveryRecord["precheck"][number] | undefined {
  if (!isRecord(raw)) return undefined
  const criterion_id = typeof raw.criterion_id === "number" ? raw.criterion_id : undefined
  const status = readString(raw.status)
  const detail = readString(raw.detail)
  if (criterion_id === undefined || !status || !detail) return undefined
  if (!["met", "unmet", "partial", "skipped"].includes(status)) return undefined
  return { criterion_id, status: status as DeliveryRecord["precheck"][number]["status"], detail }
}

function parseReview(raw: unknown): DeliveryReview | undefined {
  if (!isRecord(raw)) return undefined
  const reviewed_by = readString(raw.reviewed_by)
  const reviewed_at = readString(raw.reviewed_at)
  const decision = readString(raw.decision)
  if (!reviewed_by || !reviewed_at || !decision) return undefined
  if (!["revision_requested", "rejected", "finalized"].includes(decision)) return undefined
  const failed = Array.isArray(raw.failed_criteria)
    ? raw.failed_criteria.filter((item): item is number => typeof item === "number")
    : undefined
  return {
    reviewed_by,
    reviewed_at,
    decision: decision as ReviewDecision,
    ...(failed && failed.length > 0 && { failed_criteria: failed }),
    ...(readString(raw.user_feedback) && { user_feedback: readString(raw.user_feedback) }),
    ...(readString(raw.revision_brief) && { revision_brief: readString(raw.revision_brief) }),
  }
}

function parseDeliveryRecord(raw: unknown): DeliveryRecord | undefined {
  if (!isRecord(raw)) return undefined
  const version = typeof raw.version === "number" ? raw.version : undefined
  const status = readString(raw.status)
  const submitted_at = readString(raw.submitted_at)
  const submitted_by_node = readString(raw.submitted_by_node)
  const report_path = readString(raw.report_path)
  if (!version || !status || !submitted_at || !submitted_by_node || !report_path) return undefined
  const criteria = Array.isArray(raw.criteria)
    ? raw.criteria.flatMap((item) => {
        const parsed = parseCriterion(item)
        return parsed ? [parsed] : []
      })
    : []
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.flatMap((item) => {
        const parsed = parseEvidence(item)
        return parsed ? [parsed] : []
      })
    : []
  const precheck = Array.isArray(raw.precheck)
    ? raw.precheck.flatMap((item) => {
        const parsed = parsePrecheck(item)
        return parsed ? [parsed] : []
      })
    : []
  return {
    version,
    status: status as DeliveryRecord["status"],
    submitted_at,
    submitted_by_node,
    report_path,
    criteria,
    evidence,
    precheck,
    ...(readString(raw.blog_post_id) && { blog_post_id: readString(raw.blog_post_id) }),
    ...(Array.isArray(raw.pending_publish_paths) && {
      pending_publish_paths: raw.pending_publish_paths.filter((item): item is string => typeof item === "string"),
    }),
    ...(Array.isArray(raw.published_artifacts) && {
      published_artifacts: raw.published_artifacts.filter((item): item is string => typeof item === "string"),
    }),
    ...(readString(raw.summary) && { summary: readString(raw.summary) }),
    ...(readString(raw.force_reason) && { force_reason: readString(raw.force_reason) }),
    ...(parseReview(raw.review) && { review: parseReview(raw.review) }),
    ...(readString(raw.superseded_at) && { superseded_at: readString(raw.superseded_at) }),
  }
}

export function parseDeliveryDocument(text: string, missionId: string): DeliveryDocument {
  const raw = parseYaml(text)
  if (!isRecord(raw)) throw new Error("delivery.yaml must be a mapping")
  const activeRaw = raw.active
  const active = activeRaw ? parseDeliveryRecord(activeRaw) : undefined
  const history = Array.isArray(raw.history)
    ? raw.history.flatMap((item) => {
        const parsed = parseDeliveryRecord(item)
        return parsed ? [parsed] : []
      })
    : []
  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : DELIVERY_SCHEMA_VERSION,
    mission_id: readString(raw.mission_id) ?? missionId,
    ...(active && { active }),
    history,
  }
}

export async function readDeliveryDocument(projectDirectory: string, missionId: string) {
  const file = Bun.file(deliveryDocumentPath(projectDirectory, missionId))
  if (!(await file.exists())) return undefined
  return parseDeliveryDocument(await file.text(), missionId)
}

export async function writeDeliveryDocument(projectDirectory: string, doc: DeliveryDocument) {
  const target = deliveryDocumentPath(projectDirectory, missionIdFromDoc(doc))
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, stringifyYaml(doc))
  return deliveryDocumentRelPath(doc.mission_id)
}

function missionIdFromDoc(doc: DeliveryDocument) {
  return doc.mission_id
}

export function nextDeliveryVersion(doc: DeliveryDocument | undefined) {
  const versions = [
    ...(doc?.active ? [doc.active.version] : []),
    ...(doc?.history.map((item) => item.version) ?? []),
  ]
  return versions.length === 0 ? 1 : Math.max(...versions) + 1
}

export function deliveryBlocksSubmit(doc: DeliveryDocument | undefined) {
  const status = doc?.active?.status
  return status === "submitted" || status === "under_review" || status === "finalized"
}

export async function buildCriteriaForMission(
  projectDirectory: string,
  missionId: string,
  entry: MissionEntry,
) {
  const rawDoneWhen = await readMissionRawDoneWhen(projectDirectory, missionId)
  return criteriaFromMissionEntry(entry, rawDoneWhen)
}

export type SubmitDeliveryInput = {
  projectDirectory: string
  missionId: string
  submittedByNode: string
  reportPath: string
  summary?: string
  pendingPublishPaths?: string[]
  publishedArtifacts?: string[]
  forceReason?: string
  evidence?: DeliveryEvidence[]
  missionEntry: MissionEntry
}

export async function submitDeliveryRecord(input: SubmitDeliveryInput) {
  const existing = await readDeliveryDocument(input.projectDirectory, input.missionId)
  if (deliveryBlocksSubmit(existing)) {
    throw new Error(
      `Delivery v${existing?.active?.version} is ${existing?.active?.status}; wait for lead review or revision before resubmitting`,
    )
  }
  const version = nextDeliveryVersion(existing)
  if (version > MAX_DELIVERY_VERSIONS) {
    throw new Error(`Delivery version limit (${MAX_DELIVERY_VERSIONS}) exceeded for mission ${input.missionId}`)
  }
  const criteria = await buildCriteriaForMission(input.projectDirectory, input.missionId, input.missionEntry)
  const precheck = await runDeliveryPrecheck(input.projectDirectory, criteria)
  if (precheckHasUnmet(precheck) && !input.forceReason?.trim()) {
    const failed = precheck.filter((item) => item.status === "unmet")
    throw new Error(
      `Precheck failed for ${failed.length} criterion(s); fix issues or pass force_reason to submit anyway`,
    )
  }
  const record: DeliveryRecord = {
    version,
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submitted_by_node: input.submittedByNode,
    report_path: input.reportPath,
    criteria,
    ...(input.pendingPublishPaths?.length && { pending_publish_paths: input.pendingPublishPaths }),
    ...(input.publishedArtifacts?.length && { published_artifacts: input.publishedArtifacts }),
    evidence: input.evidence ?? [],
    precheck,
    ...(input.summary && { summary: input.summary }),
    ...(input.forceReason?.trim() && { force_reason: input.forceReason.trim() }),
  }
  const doc: DeliveryDocument = {
    schema_version: DELIVERY_SCHEMA_VERSION,
    mission_id: input.missionId,
    active: record,
    history: existing?.history ?? [],
  }
  const relPath = await writeDeliveryDocument(input.projectDirectory, doc)
  return { record, doc, relPath }
}

export async function markDeliveryUnderReview(projectDirectory: string, missionId: string) {
  const doc = await readDeliveryDocument(projectDirectory, missionId)
  if (!doc?.active || doc.active.status !== "submitted") return doc
  doc.active.status = "under_review"
  await writeDeliveryDocument(projectDirectory, doc)
  return doc
}

export type ReviewDeliveryInput = {
  projectDirectory: string
  missionId: string
  reviewedBy: string
  decision: ReviewDecision
  failedCriteria?: number[]
  userFeedback?: string
  revisionBrief?: string
}

export async function reviewDeliveryRecord(input: ReviewDeliveryInput) {
  const doc = await readDeliveryDocument(input.projectDirectory, input.missionId)
  if (!doc?.active) throw new Error(`No active delivery for mission ${input.missionId}`)
  if (doc.active.status !== "submitted" && doc.active.status !== "under_review") {
    throw new Error(`Delivery v${doc.active.version} cannot be reviewed from status ${doc.active.status}`)
  }
  if (input.decision === "revision_requested") {
    if (!input.revisionBrief?.trim()) {
      throw new Error("revision_brief is required when decision is revision_requested")
    }
    if (!input.failedCriteria?.length) {
      throw new Error("failed_criteria is required when decision is revision_requested")
    }
  }
  const reviewedAt = new Date().toISOString()
  const review: DeliveryReview = {
    reviewed_by: input.reviewedBy,
    reviewed_at: reviewedAt,
    decision: input.decision,
    ...(input.failedCriteria?.length && { failed_criteria: input.failedCriteria }),
    ...(input.userFeedback?.trim() && { user_feedback: input.userFeedback.trim() }),
    ...(input.revisionBrief?.trim() && { revision_brief: input.revisionBrief.trim() }),
  }
  const active = { ...doc.active, review, status: input.decision as DeliveryRecord["status"] }
  if (input.decision === "revision_requested") {
    active.status = "revision_requested"
    active.superseded_at = reviewedAt
    const history = [...doc.history, active]
    const updated: DeliveryDocument = {
      schema_version: DELIVERY_SCHEMA_VERSION,
      mission_id: input.missionId,
      history,
    }
    await writeDeliveryDocument(input.projectDirectory, updated)
    return { doc: updated, reviewed: active, revision: true as const }
  }
  active.status = "rejected"
  const updated: DeliveryDocument = {
    schema_version: DELIVERY_SCHEMA_VERSION,
    mission_id: input.missionId,
    active,
    history: doc.history,
  }
  await writeDeliveryDocument(input.projectDirectory, updated)
  return { doc: updated, reviewed: active, revision: false as const }
}

export function deliveryIsFinalized(doc: DeliveryDocument | undefined) {
  return doc?.active?.status === "finalized"
}

export function deliveryIsSubmitted(doc: DeliveryDocument | undefined) {
  const status = doc?.active?.status
  return status === "submitted" || status === "under_review"
}

export async function finalizeDeliveryOnMissionComplete(input: {
  projectDirectory: string
  missionId: string
  missionEntry: MissionEntry
  userFeedback?: string
}) {
  const doc = await readDeliveryDocument(input.projectDirectory, input.missionId)
  if (!doc?.active) {
    return { skipped: true as const, reason: "no_active_delivery" as const, published_artifacts: [] as string[] }
  }
  if (deliveryIsFinalized(doc)) {
    return {
      skipped: true as const,
      reason: "already_finalized" as const,
      published_artifacts: doc.active.published_artifacts ?? [],
    }
  }
  if (!deliveryIsSubmitted(doc)) {
    throw new Error(
      `Delivery v${doc.active.version} is ${doc.active.status}; cannot finalize on mission_complete`,
    )
  }

  const reviewedAt = new Date().toISOString()
  const review: DeliveryReview = {
    reviewed_by: "lead",
    reviewed_at: reviewedAt,
    decision: "finalized",
    ...(input.userFeedback?.trim() && { user_feedback: input.userFeedback.trim() }),
  }
  const active: DeliveryRecord = {
    ...doc.active,
    review,
    status: "finalized",
  }

  let publishPaths = active.pending_publish_paths
  if (!publishPaths?.length) {
    const criteria = await buildCriteriaForMission(input.projectDirectory, input.missionId, input.missionEntry)
    publishPaths = publishPathsFromCriteria(criteria)
  }
  if (!publishPaths?.length) {
    publishPaths = pendingMissionPublishPaths(active.criteria)
  }

  const publishedArtifacts = await publishMissionDeliverables({
    projectDirectory: input.projectDirectory,
    missionId: input.missionId,
    criteria: active.criteria,
    precheck: active.precheck,
    forceSubmit: Boolean(active.force_reason),
    paths: publishPaths,
  })
  if (publishedArtifacts.length > 0) {
    active.published_artifacts = publishedArtifacts
  }

  const updated: DeliveryDocument = {
    schema_version: DELIVERY_SCHEMA_VERSION,
    mission_id: input.missionId,
    active,
    history: doc.history,
  }
  await writeDeliveryDocument(input.projectDirectory, updated)

  return {
    skipped: false as const,
    delivery_version: active.version,
    status: active.status,
    published_artifacts: publishedArtifacts,
  }
}
