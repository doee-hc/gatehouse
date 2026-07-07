import type { Database } from "bun:sqlite"
import type {
  RegistryRetroRun,
  RegistrySkillExtractCompletion,
  RegistrySkillExtractRun,
  RegistrySkillVerifyCompletion,
  RegistrySkillVerifyRun,
  RegistrySnapshot,
} from "./types.ts"

export {
  SKILL_PIPELINE_SCHEMA_SQL,
  migrateRetroAnalystSchema,
  migrateRetroLeadNotifiedColumns,
  migrateSkillPipelineTables,
} from "./skill-pipeline-schema.ts"

export function readSkillPipelineSnapshot(db: Database): Pick<
  RegistrySnapshot,
  | "retroRuns"
  | "skillExtractRuns"
  | "skillExtractCompletions"
  | "skillVerifyRuns"
  | "skillVerifyCompletions"
> {
  const retroRuns = db
    .query("SELECT * FROM registry_retro_run ORDER BY started_at, mission_id")
    .all()
    .map((row) => {
      const record = row as {
        mission_id: string
        started_at: string
        retro_summary_submitted_at: string | null
        retro_summary_path: string | null
        architect_notified_at: string | null
        architect_lead_notified_at: string | null
        lead_retro_summary_notified_at: string | null
      }
      return {
        missionId: record.mission_id,
        startedAt: record.started_at,
        ...(record.retro_summary_submitted_at && {
          retroSummarySubmittedAt: record.retro_summary_submitted_at,
        }),
        ...(record.retro_summary_path && { retroSummaryPath: record.retro_summary_path }),
        ...(record.architect_notified_at && { architectNotifiedAt: record.architect_notified_at }),
        ...(record.architect_lead_notified_at && { architectLeadNotifiedAt: record.architect_lead_notified_at }),
        ...(record.lead_retro_summary_notified_at && {
          leadRetroSummaryNotifiedAt: record.lead_retro_summary_notified_at,
        }),
      } satisfies RegistryRetroRun
    })
  const skillExtractRuns = db
    .query("SELECT * FROM registry_skill_extract_run ORDER BY started_at, mission_id")
    .all()
    .map((row) => {
      const record = row as {
        mission_id: string
        expected_node_ids: string
        started_at: string
        verify_started_at: string | null
        curator_notified_at: string | null
        curator_lead_notified_at: string | null
      }
      return {
        missionId: record.mission_id,
        expectedNodeIds: JSON.parse(record.expected_node_ids) as string[],
        startedAt: record.started_at,
        ...(record.verify_started_at && { verifyStartedAt: record.verify_started_at }),
        ...(record.curator_notified_at && { curatorNotifiedAt: record.curator_notified_at }),
        ...(record.curator_lead_notified_at && { curatorLeadNotifiedAt: record.curator_lead_notified_at }),
      } satisfies RegistrySkillExtractRun
    })
  const skillVerifyRuns = db
    .query("SELECT * FROM registry_skill_verify_run ORDER BY started_at, mission_id")
    .all()
    .map((row) => {
      const record = row as {
        mission_id: string
        expected_node_ids: string
        started_at: string
      }
      return {
        missionId: record.mission_id,
        expectedNodeIds: JSON.parse(record.expected_node_ids) as string[],
        startedAt: record.started_at,
      } satisfies RegistrySkillVerifyRun
    })
  const skillVerifyCompletions = db
    .query("SELECT * FROM registry_skill_verify_completion ORDER BY completed_at, mission_id, node_id")
    .all()
    .map((row) => {
      const record = row as {
        mission_id: string
        node_id: string
        session_id: string
        completed_at: string
        passed: number
        report_path: string | null
      }
      return {
        missionId: record.mission_id,
        nodeId: record.node_id,
        sessionId: record.session_id,
        completedAt: record.completed_at,
        passed: record.passed === 1,
        ...(record.report_path && { reportPath: record.report_path }),
      } satisfies RegistrySkillVerifyCompletion
    })
  const skillExtractCompletions = db
    .query("SELECT * FROM registry_skill_extract_completion ORDER BY completed_at, mission_id, node_id")
    .all()
    .map((row) => {
      const record = row as {
        mission_id: string
        node_id: string
        summary_path: string | null
        session_id: string
        completed_at: string
      }
      return {
        missionId: record.mission_id,
        nodeId: record.node_id,
        sessionId: record.session_id,
        completedAt: record.completed_at,
        ...(record.summary_path && { summaryPath: record.summary_path }),
      } satisfies RegistrySkillExtractCompletion
    })
  return {
    retroRuns,
    skillExtractRuns,
    skillExtractCompletions,
    skillVerifyRuns,
    skillVerifyCompletions,
  }
}

export function writeSkillPipelineSnapshot(
  db: Database,
  snapshot: Pick<
    RegistrySnapshot,
    | "retroRuns"
    | "skillExtractRuns"
    | "skillExtractCompletions"
    | "skillVerifyRuns"
    | "skillVerifyCompletions"
  >,
) {
  db.exec("DELETE FROM registry_retro_run")
  db.exec("DELETE FROM registry_skill_extract_run")
  db.exec("DELETE FROM registry_skill_extract_completion")
  db.exec("DELETE FROM registry_skill_verify_run")
  db.exec("DELETE FROM registry_skill_verify_completion")
  const insertRetroRun = db.prepare(`
        INSERT INTO registry_retro_run (
          mission_id, started_at, retro_summary_submitted_at, retro_summary_path,
          architect_notified_at, architect_lead_notified_at, lead_retro_summary_notified_at
        ) VALUES (
          $mission_id, $started_at, $retro_summary_submitted_at, $retro_summary_path,
          $architect_notified_at, $architect_lead_notified_at, $lead_retro_summary_notified_at
        )
      `)
  for (const run of snapshot.retroRuns) {
    insertRetroRun.run({
      $mission_id: run.missionId,
      $started_at: run.startedAt,
      $retro_summary_submitted_at: run.retroSummarySubmittedAt ?? null,
      $retro_summary_path: run.retroSummaryPath ?? null,
      $architect_notified_at: run.architectNotifiedAt ?? null,
      $architect_lead_notified_at: run.architectLeadNotifiedAt ?? null,
      $lead_retro_summary_notified_at: run.leadRetroSummaryNotifiedAt ?? null,
    })
  }
  const insertSkillExtractRun = db.prepare(`
        INSERT INTO registry_skill_extract_run (
          mission_id, expected_node_ids, started_at, verify_started_at, curator_notified_at, curator_lead_notified_at
        ) VALUES ($mission_id, $expected_node_ids, $started_at, $verify_started_at, $curator_notified_at, $curator_lead_notified_at)
      `)
  for (const run of snapshot.skillExtractRuns) {
    insertSkillExtractRun.run({
      $mission_id: run.missionId,
      $expected_node_ids: JSON.stringify(run.expectedNodeIds),
      $started_at: run.startedAt,
      $verify_started_at: run.verifyStartedAt ?? null,
      $curator_notified_at: run.curatorNotifiedAt ?? null,
      $curator_lead_notified_at: run.curatorLeadNotifiedAt ?? null,
    })
  }
  const insertSkillExtractCompletion = db.prepare(`
        INSERT INTO registry_skill_extract_completion (
          mission_id, node_id, summary_path, session_id, completed_at
        ) VALUES ($mission_id, $node_id, $summary_path, $session_id, $completed_at)
      `)
  for (const item of snapshot.skillExtractCompletions) {
    insertSkillExtractCompletion.run({
      $mission_id: item.missionId,
      $node_id: item.nodeId,
      $summary_path: item.summaryPath ?? null,
      $session_id: item.sessionId,
      $completed_at: item.completedAt,
    })
  }
  const insertSkillVerifyRun = db.prepare(`
        INSERT INTO registry_skill_verify_run (
          mission_id, expected_node_ids, started_at
        ) VALUES ($mission_id, $expected_node_ids, $started_at)
      `)
  for (const run of snapshot.skillVerifyRuns) {
    insertSkillVerifyRun.run({
      $mission_id: run.missionId,
      $expected_node_ids: JSON.stringify(run.expectedNodeIds),
      $started_at: run.startedAt,
    })
  }
  const insertSkillVerifyCompletion = db.prepare(`
        INSERT INTO registry_skill_verify_completion (
          mission_id, node_id, session_id, completed_at, passed, report_path
        ) VALUES ($mission_id, $node_id, $session_id, $completed_at, $passed, $report_path)
      `)
  for (const item of snapshot.skillVerifyCompletions) {
    insertSkillVerifyCompletion.run({
      $mission_id: item.missionId,
      $node_id: item.nodeId,
      $session_id: item.sessionId,
      $completed_at: item.completedAt,
      $passed: item.passed ? 1 : 0,
      $report_path: item.reportPath ?? null,
    })
  }
}
