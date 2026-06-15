import type { PluginInput } from "@opencode-ai/plugin"
import { gatehouseMessage } from "../i18n.ts"
import { readLocaleSync, type GatehouseLocale } from "../locale.ts"
import type { RegistryStore } from "../registry/store.ts"
import { ARBITER_OPENCODE } from "../registry/types.ts"
import { listPermissions, permissionReplyStale, replyPermission, serverPendingRequestIds } from "../permission/client.ts"
import { promptSession, sessionExists, type GatehouseClient } from "../session/client.ts"
import { PermissionQueue, permissionCaseFromEvent } from "./queue.ts"
import type { InspectorReply, PermissionCase } from "./types.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatCasePrompt(
  item: PermissionCase,
  locale: GatehouseLocale,
  requester?: { profile?: string; scope?: string; displayName?: string },
) {
  return [
    gatehouseMessage("arbiter.caseHeader", locale),
    "",
    `request_id: ${item.requestId}`,
    `session_id: ${item.sessionId}`,
    `permission: ${item.permission}`,
    `patterns: ${JSON.stringify(item.patterns)}`,
    `metadata: ${JSON.stringify(item.metadata)}`,
    `always: ${JSON.stringify(item.always)}`,
    ...(item.tool ? [`tool_call_id: ${item.tool.callID}`] : []),
    ...(requester
      ? [
          "",
          gatehouseMessage("arbiter.requesterHeader", locale),
          `- profile: ${requester.profile ?? "unknown"}`,
          `- scope: ${requester.scope ?? "unknown"}`,
          `- display_name: ${requester.displayName ?? "unknown"}`,
        ]
      : []),
    "",
    gatehouseMessage("arbiter.reviewHint", locale),
  ].join("\n")
}

export class PermissionArbiter {
  readonly queue: PermissionQueue
  private notifying = new Set<string>()

  constructor(
    private input: PluginInput,
    private registry: RegistryStore,
  ) {
    this.queue = new PermissionQueue(input.directory)
  }

  arbiterSessionId() {
    return this.registry.byProfile("arbiter", "outer")?.sessionId
  }

  isArbiterSession(sessionId: string) {
    return sessionId === this.arbiterSessionId()
  }

  async ensureInspectorReady() {
    const arbiter = this.registry.byProfile("arbiter", "outer")
    if (!arbiter?.sessionId) return undefined
    const client = this.input.client as GatehouseClient
    if (!(await sessionExists(client, this.input.directory, arbiter.sessionId))) return undefined
    return arbiter.sessionId
  }

  async handlePermissionAsked(properties: Record<string, unknown>) {
    const item = permissionCaseFromEvent(properties)
    if (!item) return
    if (this.isArbiterSession(item.sessionId)) return

    this.queue.upsert({ ...item, directory: this.input.directory })
    const arbiterSessionId = await this.ensureInspectorReady()
    if (!arbiterSessionId) return
    if (this.notifying.has(item.requestId)) return
    this.notifying.add(item.requestId)

    const requester = this.registry.bySession(item.sessionId)
    await promptSession(this.input.client as import("../session/client.ts").GatehouseClient, this.input.directory, arbiterSessionId, {
      profile: ARBITER_OPENCODE,
      text: formatCasePrompt(item, readLocaleSync(this.input.directory), requester),
    }, this.input).finally(() => {
      this.notifying.delete(item.requestId)
    })
  }

  async handlePermissionReplied(properties: Record<string, unknown>) {
    if (typeof properties.requestID !== "string") return
    this.queue.remove(properties.requestID)
  }

  async handleInstanceDisposed(directory: string) {
    if (directory !== this.input.directory) return
    this.queue.clear()
  }

  async listQueueWithStatus() {
    const serverIds = await serverPendingRequestIds(this.input).catch(() => new Set<string>())
    return this.queue.list().map((item) => ({
      ...item,
      opencode_pending: serverIds.has(item.requestId),
    }))
  }

  async applyDecision(input: {
    arbiterSessionId: string
    requestId: string
    reply: InspectorReply
    reason: string
    toolDirectory?: string
  }) {
    const pending = this.queue.get(input.requestId)
    if (!pending) throw new Error(`unknown or already decided permission request: ${input.requestId}`)

    try {
      await replyPermission(this.input, {
        requestId: input.requestId,
        sessionId: pending.sessionId,
        reply: input.reply,
        directoryHints: [pending.directory, input.toolDirectory, this.input.directory, this.input.worktree].filter(
          (directory): directory is string => typeof directory === "string" && directory.length > 0,
        ),
        ...(input.reply === "reject" && input.reason ? { message: input.reason } : {}),
      })
    } catch (error) {
      if (permissionReplyStale(error)) {
        this.queue.remove(input.requestId)
        throw new Error(
          `permission request ${input.requestId} could not be routed to OpenCode pending via Gatehouse (workspaces/directories all tried). If TUI still allows manual Allow, the request is still valid — restart OpenCode to load the latest gatehouse and retry decide; otherwise have the requesting agent re-submit the permission request.`,
        )
      }
      throw error
    }

    this.queue.remove(input.requestId)
    await this.queue.appendDecision({
      requestId: input.requestId,
      sessionId: pending.sessionId,
      permission: pending.permission,
      reply: input.reply,
      reason: input.reason,
      arbiterSessionId: input.arbiterSessionId,
      decidedAt: new Date().toISOString(),
    })
  }

  async syncPendingFromServer() {
    const listed = await listPermissions(this.input)
    const arbiterSessionId = this.arbiterSessionId()
    for (const entry of listed.data ?? []) {
      if (!isRecord(entry)) continue
      const item = permissionCaseFromEvent(entry)
      if (!item) continue
      if (arbiterSessionId && item.sessionId === arbiterSessionId) continue
      this.queue.upsert({ ...item, directory: this.input.directory })
    }
  }
}

const arbiters = new Map<string, Promise<PermissionArbiter>>()

export async function getPermissionArbiter(input: PluginInput, registry: RegistryStore) {
  const key = input.directory
  const existing = arbiters.get(key)
  if (existing) return existing
  const created = (async () => {
    const arbiter = new PermissionArbiter(input, registry)
    await arbiter.syncPendingFromServer().catch(() => undefined)
    return arbiter
  })()
  arbiters.set(key, created)
  return created
}

export function permissionEventProperties(event: unknown) {
  if (!isRecord(event)) return undefined
  if (isRecord(event.properties)) return event.properties
  return undefined
}
