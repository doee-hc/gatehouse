import type { Config } from "@opencode-ai/plugin"
import { loadArchitectPrompt } from "../prompt/architect.ts"
import { loadArbiterPrompt } from "../prompt/arbiter.ts"
import { loadCuratorPrompt } from "../prompt/curator.ts"
import { loadAgentDescription, loadBundledAgentDescription } from "../prompt/agent-template.ts"
import { loadLeadPrompt } from "../prompt/lead.ts"
import {
  LEAD_OPENCODE,
  INNER_COORDINATOR_AGENT,
  INNER_EXECUTION_AGENT,
  INNER_EXTRACT_AGENT,
  INNER_VERIFY_AGENT,
  INNER_ROOT_AGENT,
  INNER_ROOT_SOLO_AGENT,
  ARCHITECT_OPENCODE,
  ARBITER_OPENCODE,
  CURATOR_OPENCODE,
} from "../registry/types.ts"
import {
  leadPermissions,
  architectSessionPermissions,
  curatorSessionPermissions,
  buildCoordinatorPermissions,
  buildExtractPermissions,
  buildVerifyPermissions,
  buildRootPermissions,
  buildRootSoloPermissions,
  buildExecutionPermissions,
  arbiterSessionPermissions,
  globalGatehousePermissions,
  hiddenToolsFromPermissions,
  type AgentPermissionMap,
} from "./permissions.ts"

const gatehouseSkillsPath = ".gatehouse"

const AGENT_FILES = {
  lead: "lead.md",
  architect: "architect.md",
  curator: "curator.md",
  arbiter: "arbiter.md",
  buildRoot: "build-root.md",
  buildRootSolo: "build-root-solo.md",
  buildCoordinator: "build-coordinator.md",
  buildExtract: "build-extract.md",
  buildVerify: "build-verify.md",
  build: "build.md",
} as const

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

async function loadAgentDescriptions(projectDirectory?: string) {
  if (!projectDirectory) {
    const bundledLoad = (file: string) => loadBundledAgentDescription(file)
    return {
      lead: await bundledLoad(AGENT_FILES.lead),
      architect: await bundledLoad(AGENT_FILES.architect),
      curator: await bundledLoad(AGENT_FILES.curator),
      arbiter: await bundledLoad(AGENT_FILES.arbiter),
      buildRoot: await bundledLoad(AGENT_FILES.buildRoot),
      buildRootSolo: await bundledLoad(AGENT_FILES.buildRootSolo),
      buildCoordinator: await bundledLoad(AGENT_FILES.buildCoordinator),
      buildExtract: await bundledLoad(AGENT_FILES.buildExtract),
      buildVerify: await bundledLoad(AGENT_FILES.buildVerify),
      build: await bundledLoad(AGENT_FILES.build),
    }
  }
  const load = (file: string) => loadAgentDescription(projectDirectory, file)
  return {
    lead: await load(AGENT_FILES.lead),
    architect: await load(AGENT_FILES.architect),
    curator: await load(AGENT_FILES.curator),
    arbiter: await load(AGENT_FILES.arbiter),
    buildRoot: await load(AGENT_FILES.buildRoot),
    buildRootSolo: await load(AGENT_FILES.buildRootSolo),
    buildCoordinator: await load(AGENT_FILES.buildCoordinator),
    buildExtract: await load(AGENT_FILES.buildExtract),
    buildVerify: await load(AGENT_FILES.buildVerify),
    build: await load(AGENT_FILES.build),
  }
}

export async function applyGatehouseConfig(cfg: Config, projectDirectory?: string) {
  const record = cfg as Record<string, unknown>

  if (typeof record.default_agent !== "string") record.default_agent = LEAD_OPENCODE

  const skills = (record.skills ??= {}) as { paths?: string[] }
  const paths = Array.isArray(skills.paths) ? skills.paths : []
  if (!paths.includes(gatehouseSkillsPath)) skills.paths = [...paths, gatehouseSkillsPath]

  const permission = (record.permission ??= {}) as Record<string, string>
  for (const [key, value] of Object.entries(globalGatehousePermissions) as [string, string][]) {
    permission[key] = value
  }

  const agents = (record.agent ??= {}) as Record<string, Record<string, unknown>>
  const descriptions = await loadAgentDescriptions(projectDirectory)

  mergeAgent(
    agents,
    LEAD_OPENCODE,
    {
      mode: "primary",
      ...(descriptions.lead ? { description: descriptions.lead } : {}),
      color: "#C9A227",
      ...(projectDirectory ? { prompt: await loadLeadPrompt(projectDirectory) } : {}),
    },
    leadPermissions,
    hiddenToolsFromPermissions(leadPermissions),
  )

  mergeAgent(
    agents,
    ARCHITECT_OPENCODE,
    {
      mode: "primary",
      ...(descriptions.architect ? { description: descriptions.architect } : {}),
      color: "#6B5B95",
      ...(projectDirectory ? { prompt: await loadArchitectPrompt(projectDirectory) } : {}),
    },
    architectSessionPermissions,
    hiddenToolsFromPermissions(architectSessionPermissions),
  )

  mergeAgent(
    agents,
    CURATOR_OPENCODE,
    {
      mode: "primary",
      ...(descriptions.curator ? { description: descriptions.curator } : {}),
      color: "#8B6914",
      ...(projectDirectory ? { prompt: await loadCuratorPrompt(projectDirectory) } : {}),
    },
    curatorSessionPermissions,
    hiddenToolsFromPermissions(curatorSessionPermissions),
  )

  mergeAgent(
    agents,
    INNER_ROOT_AGENT,
    {
      mode: "primary",
      ...(descriptions.buildRoot ? { description: descriptions.buildRoot } : {}),
      color: "#2E6F8F",
    },
    buildRootPermissions,
    hiddenToolsFromPermissions(buildRootPermissions),
  )

  mergeAgent(
    agents,
    INNER_ROOT_SOLO_AGENT,
    {
      mode: "primary",
      ...(descriptions.buildRootSolo ? { description: descriptions.buildRootSolo } : {}),
      color: "#3A8F7A",
    },
    buildRootSoloPermissions,
    hiddenToolsFromPermissions(buildRootSoloPermissions),
  )

  mergeAgent(
    agents,
    INNER_COORDINATOR_AGENT,
    {
      mode: "primary",
      ...(descriptions.buildCoordinator ? { description: descriptions.buildCoordinator } : {}),
      color: "#4A90A4",
    },
    buildCoordinatorPermissions,
    hiddenToolsFromPermissions(buildCoordinatorPermissions),
  )

  mergeAgent(
    agents,
    INNER_EXECUTION_AGENT,
    {
      mode: "primary",
      ...(descriptions.build ? { description: descriptions.build } : {}),
      color: "#5A7A5E",
    },
    buildExecutionPermissions,
    hiddenToolsFromPermissions(buildExecutionPermissions),
  )

  mergeAgent(
    agents,
    INNER_EXTRACT_AGENT,
    {
      mode: "primary",
      ...(descriptions.buildExtract ? { description: descriptions.buildExtract } : {}),
      color: "#6B8E4E",
    },
    buildExtractPermissions,
    hiddenToolsFromPermissions(buildExtractPermissions),
  )

  mergeAgent(
    agents,
    INNER_VERIFY_AGENT,
    {
      mode: "primary",
      ...(descriptions.buildVerify ? { description: descriptions.buildVerify } : {}),
      color: "#7A6B4E",
    },
    buildVerifyPermissions,
    hiddenToolsFromPermissions(buildVerifyPermissions),
  )

  mergeAgent(
    agents,
    ARBITER_OPENCODE,
    {
      mode: "primary",
      ...(descriptions.arbiter ? { description: descriptions.arbiter } : {}),
      color: "#B84A4A",
      ...(projectDirectory ? { prompt: await loadArbiterPrompt(projectDirectory) } : {}),
    },
    arbiterSessionPermissions,
    hiddenToolsFromPermissions(arbiterSessionPermissions),
  )
}
