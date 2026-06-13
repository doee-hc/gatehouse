export const DELIVERY_SCHEMA_VERSION = 1
export const MAX_DELIVERY_VERSIONS = 10

export type DeliveryCheckKind = "manual" | "path_exists" | "command"

export type DoneWhenCheck =
  | { kind: "manual" }
  | { kind: "path_exists"; path: string }
  | { kind: "command"; cmd: string; expect_exit?: number }

export type DoneWhenCriterion = {
  id: number
  text: string
  check: DoneWhenCheck
  /** @deprecated Legacy publish: metadata; criteria no longer set this on parse. */
  publishPath?: string
}

export type DeliveryCriterionStatus = "met" | "unmet" | "partial" | "skipped"

export type DeliveryStatus =
  | "submitted"
  | "under_review"
  | "finalized"
  | "revision_requested"
  | "rejected"
  | "superseded"

/** Lead calls gatehouse_delivery_review for rework or rejection only. */
export type ReviewDecision = "revision_requested" | "rejected"

/** Written on delivery.review when gatehouse_mission_complete finalizes a submitted delivery. */
export type FinalizeDecision = "finalized"

export type DeliveryEvidence = {
  criterion_id: number
  status: DeliveryCriterionStatus
  proof?: string
}

export type DeliveryPrecheck = {
  criterion_id: number
  status: DeliveryCriterionStatus
  detail: string
}

export type DeliveryReview = {
  reviewed_by: string
  reviewed_at: string
  decision: ReviewDecision | FinalizeDecision
  failed_criteria?: number[]
  user_feedback?: string
  revision_brief?: string
}

export type DeliveryRecord = {
  version: number
  status: DeliveryStatus
  submitted_at: string
  submitted_by_node: string
  /** @deprecated Legacy deliveries only; new records omit this field. */
  report_path?: string
  blog_post_id?: string
  /** @deprecated Computed at read time from criteria; not persisted on new records. */
  pending_publish_paths?: string[]
  published_artifacts?: string[]
  summary?: string
  force_reason?: string
  criteria: DoneWhenCriterion[]
  evidence: DeliveryEvidence[]
  precheck: DeliveryPrecheck[]
  review?: DeliveryReview
  superseded_at?: string
}

export type DeliveryDocument = {
  schema_version: number
  mission_id: string
  active?: DeliveryRecord
  history: DeliveryRecord[]
}
