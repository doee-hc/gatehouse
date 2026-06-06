import type { PluginInput } from "@opencode-ai/plugin"
import { sessionModelFromConfig, type GatehouseSessionModelRef } from "../gatehouse-config.ts"
import { opencodeHttpReady, promptSessionHttp } from "./http.ts"
import { readString } from "../yaml.ts"

export type { GatehouseSessionModelRef }

function sessionCreateModelBody(model: string | undefined) {
  const ref = sessionModelFromConfig(model ?? "")
  if (!ref) return undefined
  return { providerID: ref.providerID, id: ref.id }
}

function sessionPromptModelBody(model: string | undefined) {
  const ref = sessionModelFromConfig(model ?? "")
  if (!ref) return undefined
  return { providerID: ref.providerID, modelID: ref.id }
}

export type GatehouseClient = {
  session: {
    create(input: unknown): Promise<unknown>
    fork?(input: unknown): Promise<unknown>
    update?(input: unknown): Promise<unknown>
    promptAsync(input: unknown): Promise<unknown>
    messages(input: unknown): Promise<unknown>
    get(input: unknown): Promise<unknown>
    status?(input?: unknown): Promise<unknown>
    todo?(input: unknown): Promise<unknown>
  }
}

export function directoryQuery(directory: string) {
  return { query: { directory } } as const
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function responseSessionId(value: unknown) {
  if (!isRecord(value)) return
  if (typeof value.id === "string") return value.id
  if (isRecord(value.data) && typeof value.data.id === "string") return value.data.id
}

export async function createSession(
  client: GatehouseClient,
  directory: string,
  input: { display_name: string; profile?: string; model?: string },
) {
  const model = sessionCreateModelBody(input.model)
  const created = await client.session.create({
    ...directoryQuery(directory),
    body: {
      title: input.display_name,
      ...(input.profile && { agent: input.profile }),
      ...(model && { model }),
    },
  })
  const sessionId = responseSessionId(created)
  if (!sessionId) throw new Error("session.create did not return session id")
  return sessionId
}

export async function updateSessionTitle(
  client: GatehouseClient,
  directory: string,
  sessionId: string,
  title: string,
) {
  if (typeof client.session.update !== "function") return
  await client.session.update({
    ...directoryQuery(directory),
    path: { id: sessionId },
    body: { title },
  }).catch(() => undefined)
}

export async function forkSession(
  client: GatehouseClient,
  directory: string,
  sessionId: string,
  display_name: string,
) {
  if (typeof client.session.fork !== "function") throw new Error("client.session.fork is unavailable")
  const forked = await client.session.fork({
    ...directoryQuery(directory),
    path: { id: sessionId },
  })
  const forkId = responseSessionId(forked)
  if (!forkId) throw new Error("session.fork did not return session id")
  await updateSessionTitle(client, directory, forkId, display_name)
  return forkId
}

export async function promptSession(
  client: GatehouseClient,
  directory: string,
  sessionId: string,
  input: { profile?: string; text?: string; system?: string; noReply?: boolean; model?: string },
  plugin?: PluginInput,
) {
  if (plugin && (await opencodeHttpReady(plugin))) {
    try {
      await promptSessionHttp(plugin, sessionId, {
        ...(input.profile && { agent: input.profile }),
        text: input.text,
        system: input.system,
        noReply: input.noReply,
        model: input.model,
      })
      return
    } catch {
      // Fall back to SDK when the HTTP route fails mid-flight.
    }
  }
  const model = sessionPromptModelBody(input.model)
  await client.session.promptAsync({
    ...directoryQuery(directory),
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: input.text ?? "" }],
      ...(input.profile && { agent: input.profile }),
      ...(input.system && { system: input.system }),
      ...(input.noReply && { noReply: true }),
      ...(model && { model }),
    },
  })
}

export async function sessionMessages(client: GatehouseClient, directory: string, sessionId: string) {
  const messages = await client.session.messages({
    ...directoryQuery(directory),
    path: { id: sessionId },
  })
  if (!isRecord(messages) || !Array.isArray(messages.data)) return []
  return messages.data
}

export async function sessionDetail(client: GatehouseClient, directory: string, sessionId: string) {
  const detail = await client.session.get({
    ...directoryQuery(directory),
    path: { id: sessionId },
  }).catch(() => undefined)
  if (!isRecord(detail) || !isRecord(detail.data)) return undefined
  return detail.data
}

export async function sessionDirectory(client: GatehouseClient, queryDirectory: string, sessionId: string) {
  const detail = await sessionDetail(client, queryDirectory, sessionId)
  if (isRecord(detail) && typeof detail.directory === "string" && detail.directory) return detail.directory
  return queryDirectory
}

export async function sessionWorkspaceId(client: GatehouseClient, queryDirectory: string, sessionId: string) {
  const detail = await sessionDetail(client, queryDirectory, sessionId)
  if (isRecord(detail) && typeof detail.workspaceID === "string" && detail.workspaceID) return detail.workspaceID
}

export async function sessionExists(client: GatehouseClient, directory: string, sessionId: string) {
  return (await sessionDetail(client, directory, sessionId)) !== undefined
}

export async function sessionTodo(client: GatehouseClient, directory: string, sessionId: string) {
  if (typeof client.session.todo !== "function") return []
  const response = await client.session.todo({
    ...directoryQuery(directory),
    path: { id: sessionId },
  })
  if (Array.isArray(response)) {
    return response.filter(isRecord).map((item) => ({
      content: typeof item.content === "string" ? item.content : "",
      status: typeof item.status === "string" ? item.status : "pending",
      priority: typeof item.priority === "string" ? item.priority : "medium",
    }))
  }
  if (!isRecord(response) || !Array.isArray(response.data)) return []
  return response.data.filter(isRecord).map((item) => ({
    content: typeof item.content === "string" ? item.content : "",
    status: typeof item.status === "string" ? item.status : "pending",
    priority: typeof item.priority === "string" ? item.priority : "medium",
  }))
}

export function sessionDurationMs(detail: Record<string, unknown> | undefined) {
  const time = isRecord(detail?.time) ? detail.time : undefined
  const created = typeof time?.created === "number" ? time.created : undefined
  const updated = typeof time?.updated === "number" ? time.updated : undefined
  if (created === undefined || updated === undefined) return undefined
  return Math.max(0, updated - created)
}

export function sessionAgent(detail: Record<string, unknown> | undefined) {
  return readString(detail?.agent)
}
