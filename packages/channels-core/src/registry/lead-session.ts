import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { DEFAULT_AGENT_ID } from "../constants.ts"
import type { OpencodeClient } from "../opencode/client.ts"
import { gatehouseConfigPath } from "../portal/config.ts"
import type { ChannelBridgeConfig } from "../types.ts"
import {
  opencodeSessionExists,
  readRegistryAgentById,
  type RegistryAgentTarget,
} from "./agent-target.ts"
import { upsertLeadRegistryAgent } from "./registry-write.ts"

const LEAD_OPENCODE = "lead"

const DEFAULT_LEAD_DISPLAY_NAME = "Lead"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseYaml(text: string): unknown {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.parse === "function") {
    return Bun.YAML.parse(text)
  }
  throw new Error("Bun.YAML.parse is required to read Gatehouse YAML config")
}

function readGatehouseConfigLayer(filePath: string) {
  if (!existsSync(filePath)) return undefined
  const parsed = parseYaml(readFileSync(filePath, "utf8"))
  return isRecord(parsed) ? parsed : undefined
}

export function readLeadDisplayName(projectDir: string) {
  const config = readGatehouseConfigLayer(gatehouseConfigPath(projectDir))
  const agents = isRecord(config?.agents) ? config.agents : undefined
  const lead = isRecord(agents?.lead) ? agents.lead : undefined
  const name = typeof lead?.name === "string" ? lead.name.trim() : ""
  return name || DEFAULT_LEAD_DISPLAY_NAME
}

function readLeadModel(projectDir: string) {
  const config = readGatehouseConfigLayer(gatehouseConfigPath(projectDir))
  const models = isRecord(config?.models) ? config.models : undefined
  const model = typeof models?.lead === "string" ? models.lead.trim() : ""
  return model || undefined
}

function sessionCreateModelBody(model: string | undefined) {
  if (!model) return undefined
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) return undefined
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
}

function responseSessionId(value: unknown) {
  if (!isRecord(value)) return
  if (typeof value.id === "string") return value.id
  if (isRecord(value.data) && typeof value.data.id === "string") return value.data.id
}

function stripMarkdownFrontmatter(text: string) {
  if (!text.startsWith("---")) return text.trim()
  const end = text.indexOf("\n---", 3)
  if (end === -1) return text.trim()
  return text.slice(end + 4).trim()
}

function globalOpencodeAgentPath(filename: string) {
  const fromEnv = process.env.GATEHOUSE_GLOBAL_OPENCODE_DIR?.trim()
  const root = fromEnv ? path.resolve(fromEnv) : path.join(homedir(), ".config", "opencode")
  return path.join(root, "agent", filename)
}

async function resolveLeadPromptPath() {
  const global = globalOpencodeAgentPath("lead.md")
  if (await Bun.file(global).exists()) return global
  return undefined
}

function renderLeadPrompt(template: string, displayName: string) {
  return template
    .replaceAll("{{name}}", displayName)
    .replaceAll("{{lead_name}}", displayName)
}

async function loadLeadSystemPrompt(projectDir: string) {
  const file = await resolveLeadPromptPath()
  if (!file) return undefined
  const template = stripMarkdownFrontmatter(await Bun.file(file).text())
  return renderLeadPrompt(template, readLeadDisplayName(projectDir))
}

async function createLeadOpencodeSession(client: OpencodeClient, config: ChannelBridgeConfig) {
  const displayName = readLeadDisplayName(config.projectDir)
  const model = sessionCreateModelBody(readLeadModel(config.projectDir))
  const created = await client.session.create({
    query: { directory: config.projectDir },
    body: {
      title: displayName,
      agent: LEAD_OPENCODE,
      ...(model && { model }),
    } as { title: string },
  })
  const sessionId = responseSessionId(created)
  if (!sessionId) throw new Error("session.create did not return session id")
  return { sessionId, displayName }
}

async function syncLeadSessionTitle(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
  sessionId: string,
  displayName: string,
) {
  if (typeof client.session.update !== "function") return
  await client.session
    .update({
      query: { directory: config.projectDir },
      path: { id: sessionId },
      body: { title: displayName },
    })
    .catch(() => undefined)
}

async function injectLeadSystemPrompt(client: OpencodeClient, config: ChannelBridgeConfig, sessionId: string) {
  const system = await loadLeadSystemPrompt(config.projectDir)
  if (!system) return
  const model = readLeadModel(config.projectDir)
  const modelBody = model
    ? (() => {
        const slash = model.indexOf("/")
        if (slash <= 0 || slash === model.length - 1) return undefined
        return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
      })()
    : undefined
  await client.session.promptAsync({
    query: { directory: config.projectDir },
    path: { id: sessionId },
    body: {
      agent: LEAD_OPENCODE,
      system,
      noReply: true,
      parts: [{ type: "text", text: "" }],
      ...(modelBody && { model: modelBody }),
    },
  })
}

export async function ensureLeadAgentTarget(
  client: OpencodeClient,
  config: ChannelBridgeConfig,
): Promise<RegistryAgentTarget> {
  const existing = readRegistryAgentById(config.projectDir, DEFAULT_AGENT_ID)
  if (existing && (await opencodeSessionExists(client, config, existing.sessionId))) {
    return existing
  }

  const { sessionId, displayName } = await createLeadOpencodeSession(client, config)
  upsertLeadRegistryAgent(config.projectDir, {
    sessionId,
    displayName,
    createdAt: existing ? undefined : new Date().toISOString(),
  })
  await syncLeadSessionTitle(client, config, sessionId, displayName)
  await injectLeadSystemPrompt(client, config, sessionId)

  return {
    agentId: DEFAULT_AGENT_ID,
    scope: "outer",
    sessionId,
    displayName,
    opencodeAgent: LEAD_OPENCODE,
  }
}
