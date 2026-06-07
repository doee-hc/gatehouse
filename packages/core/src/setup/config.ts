import type { Config } from "@opencode-ai/plugin"
import { loadArchitectPrompt } from "../prompt/architect.ts"
import { loadArbiterPrompt } from "../prompt/arbiter.ts"
import { loadCuratorPrompt } from "../prompt/curator.ts"
import { loadAgentDescription } from "../prompt/agent-template.ts"
import { loadLeadPrompt } from "../prompt/lead.ts"
import {
  LEAD_OPENCODE,
  INNER_COORDINATOR_AGENT,
  ARCHITECT_OPENCODE,
  ARBITER_OPENCODE,
  CURATOR_OPENCODE,
} from "../registry/types.ts"
import {
  leadPermissions,
  architectSessionPermissions,
  curatorSessionPermissions,
  buildCoordinatorPermissions,
  arbiterSessionPermissions,
  globalGatehousePermissions,
  hiddenToolsFromPermissions,
  type AgentPermissionMap,
} from "./permissions.ts"

const gatehouseSkillsPath = ".gatehouse"

function mergeAgent(
  agents: Record<string, Record<string, unknown>>,
  name: string,
  defaults: Record<string, unknown>,
  permission: AgentPermissionMap,
  tools?: Record<string, boolean>,
) {
  const existing = agents[name] ?? {}
  const existingPermission =
    typeof existing.permission === "object" && existing.permission !== null
      ? (existing.permission as Record<string, unknown>)
      : {}
  const existingTools =
    typeof existing.tools === "object" && existing.tools !== null
      ? (existing.tools as Record<string, boolean>)
      : {}
  agents[name] = {
    ...defaults,
    ...existing,
    permission: {
      ...existingPermission,
      ...permission,
    },
    ...(tools && Object.keys(tools).length > 0
      ? {
          tools: {
            ...existingTools,
            ...tools,
          },
        }
      : {}),
  }
}

export async function applyGatehouseConfig(cfg: Config, projectDirectory?: string) {
  const record = cfg as Record<string, unknown>

  if (typeof record.default_agent !== "string") record.default_agent = LEAD_OPENCODE

  const skills = (record.skills ??= {}) as { paths?: string[] }
  const paths = Array.isArray(skills.paths) ? skills.paths : []
  if (!paths.includes(gatehouseSkillsPath)) skills.paths = [...paths, gatehouseSkillsPath]

  const permission = (record.permission ??= {}) as Record<string, string>
  for (const [key, value] of Object.entries(globalGatehousePermissions)) {
    permission[key] = value
  }

  const agents = (record.agent ??= {}) as Record<string, Record<string, unknown>>

  mergeAgent(
    agents,
    LEAD_OPENCODE,
    {
      mode: "primary",
      description: "统筹任务从规划到交付、收尾：结合长期方向选定当前要做的任务，与你一起敲定目标、细节和约束；启动任务后跟进交付，与你确认达到标准后正式结束任务。",
      color: "#C9A227",
    },
    leadPermissions,
    hiddenToolsFromPermissions(leadPermissions),
  )

  mergeAgent(
    agents,
    ARCHITECT_OPENCODE,
    {
      mode: "primary",
      description: "管理团队的组织方式：按任务特点搭一支能高效协作的执行队伍，任务结束后队伍解散；通过复盘看执行效率与成本，持续改进更适合该类任务的团队结构。",
      color: "#6B5B95",
    },
    architectSessionPermissions,
    hiddenToolsFromPermissions(architectSessionPermissions),
  )

  mergeAgent(
    agents,
    CURATOR_OPENCODE,
    {
      mode: "primary",
      description: "维护各领域的技能资料：任务开始前为每位执行者分配合适的领域技能；任务复盘时把执行者更新过的技能整理归档，供后续任务复用。",
      color: "#8B6914",
    },
    curatorSessionPermissions,
    hiddenToolsFromPermissions(curatorSessionPermissions),
  )

  mergeAgent(
    agents,
    INNER_COORDINATOR_AGENT,
    {
      mode: "primary",
      description: "Mission 执行团队中间协调层 — 与 build 相同权限，禁止 task 生成 subagent",
      color: "#4A90A4",
    },
    buildCoordinatorPermissions,
    hiddenToolsFromPermissions(buildCoordinatorPermissions),
  )

  mergeAgent(
    agents,
    ARBITER_OPENCODE,
    {
      mode: "primary",
      description: "独立的权限审批人：按规则处理团队成员的权限申请，自动给出放行或拒绝，并完整记录每一次决定。",
      color: "#B84A4A",
    },
    arbiterSessionPermissions,
    hiddenToolsFromPermissions(arbiterSessionPermissions),
  )

  if (!projectDirectory) return

  const [leadDescription, architectDescription, curatorDescription, arbiterDescription, coordinatorDescription] =
    await Promise.all([
      loadAgentDescription(projectDirectory, "lead.md"),
      loadAgentDescription(projectDirectory, "architect.md"),
      loadAgentDescription(projectDirectory, "curator.md"),
      loadAgentDescription(projectDirectory, "arbiter.md"),
      loadAgentDescription(projectDirectory, "build-coordinator.md"),
    ])

  mergeAgent(
    agents,
    LEAD_OPENCODE,
    {
      ...(leadDescription ? { description: leadDescription } : {}),
      prompt: await loadLeadPrompt(projectDirectory),
    },
    leadPermissions,
    hiddenToolsFromPermissions(leadPermissions),
  )
  mergeAgent(
    agents,
    ARCHITECT_OPENCODE,
    {
      ...(architectDescription ? { description: architectDescription } : {}),
      prompt: await loadArchitectPrompt(projectDirectory),
    },
    architectSessionPermissions,
    hiddenToolsFromPermissions(architectSessionPermissions),
  )
  mergeAgent(
    agents,
    CURATOR_OPENCODE,
    {
      ...(curatorDescription ? { description: curatorDescription } : {}),
      prompt: await loadCuratorPrompt(projectDirectory),
    },
    curatorSessionPermissions,
    hiddenToolsFromPermissions(curatorSessionPermissions),
  )
  mergeAgent(
    agents,
    INNER_COORDINATOR_AGENT,
    {
      ...(coordinatorDescription ? { description: coordinatorDescription } : {}),
    },
    buildCoordinatorPermissions,
    hiddenToolsFromPermissions(buildCoordinatorPermissions),
  )
  mergeAgent(
    agents,
    ARBITER_OPENCODE,
    {
      ...(arbiterDescription ? { description: arbiterDescription } : {}),
      prompt: await loadArbiterPrompt(projectDirectory),
    },
    arbiterSessionPermissions,
    hiddenToolsFromPermissions(arbiterSessionPermissions),
  )
}
