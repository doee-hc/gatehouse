import type { PluginInput } from "@opencode-ai/plugin"
import { bootstrapTreeTool } from "./bootstrap.ts"
import { listTeamTool } from "./list-team.ts"
import { missionCompleteTool } from "./mission-complete.ts"
import { missionStartTool } from "./mission-start.ts"
import { missionInfoTool } from "./mission-info.ts"
import { missionRetroTool, retroRecordTool } from "./retro.ts"
import { applySkillDomainsTool } from "./apply-skill-domains.ts"
import { inspectorDecideTool, inspectorQueueTool } from "./inspector.ts"
import { skillExtractRecordTool } from "./skill-extract-record.ts"
import { sendMessageTool } from "./send-message.ts"
import { sessionSnapshotTool } from "./session-snapshot.ts"
import { initTeamTool } from "./init-team.ts"
import { unpublishBlogTool } from "./unpublish-blog.ts"
import { deliveryReviewTool, deliveryStatusTool } from "./delivery.ts"
import {
  executionCompleteTool,
  executionReworkTool,
  executionStatusTool,
} from "./execution.ts"
import { leadAwaitUserTool } from "./lead-await-user.ts"
import { directionStatusTool } from "./direction-status.ts"

export function createGatehouseCoreTools(input: PluginInput) {
  return {
    gatehouse_init_team: initTeamTool(input),
    gatehouse_bootstrap_tree: bootstrapTreeTool(input),
    gatehouse_list_team: listTeamTool(input),
    gatehouse_send_message: sendMessageTool(input),
    gatehouse_session_snapshot: sessionSnapshotTool(input),
    gatehouse_mission_start: missionStartTool(input),
    gatehouse_mission_info: missionInfoTool(input),
    gatehouse_mission_retro: missionRetroTool(input),
    gatehouse_mission_complete: missionCompleteTool(input),
    gatehouse_retro_record: retroRecordTool(input),
    gatehouse_apply_skill_domains: applySkillDomainsTool(input),
    gatehouse_skill_extract_record: skillExtractRecordTool(input),
    gatehouse_inspector_queue: inspectorQueueTool(input),
    gatehouse_inspector_decide: inspectorDecideTool(input),
    gatehouse_unpublish_blog: unpublishBlogTool(input),
    gatehouse_delivery_review: deliveryReviewTool(input),
    gatehouse_delivery_status: deliveryStatusTool(input),
    gatehouse_execution_complete: executionCompleteTool(input),
    gatehouse_execution_rework: executionReworkTool(input),
    gatehouse_execution_status: executionStatusTool(input),
    gatehouse_lead_await_user: leadAwaitUserTool(input),
    gatehouse_direction_status: directionStatusTool(input),
  }
}
