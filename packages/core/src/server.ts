import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { scaffoldGatehouse } from "./scaffold.ts"
import { syncManagedTemplates } from "./setup/sync-templates.ts"
import { getRegistryStore } from "./registry/context.ts"
import { ARCHITECT_OPENCODE, LEAD_OPENCODE } from "./registry/types.ts"
import { readAgentNamesSync } from "./names.ts"
import { handleOuterChatMessage } from "./registry/outer-chat-message.ts"
import { applyGatehouseConfig } from "./setup/config.ts"
import { ensureOpencodeConfig } from "./setup/project.ts"
import { GATEHOUSE_OUTER_AGENTS } from "./registry/types.ts"
import { createGatehouseCoreTools } from "./tools/index.ts"
import { getPermissionArbiter, permissionEventProperties } from "./arbiter/arbiter.ts"
import { startMissionWatchdog } from "./watchdog/mission-watchdog.ts"
import { resumeOrchestrationForRunningMissions } from "./orchestration/recover.ts"
import { startAutopilotWatchdog } from "./watchdog/autopilot.ts"
import { onLeadSessionUserMessage } from "./lead/chat-autopilot.ts"
import { startRecordWatchdogs } from "./watchdog/record-watchdog.ts"
import { loadGatehouseConfig } from "./gatehouse-config.ts"
import { notifyPortalPortInUse, PortalPortInUseError } from "./portal/ports.ts"
import { ensurePortalServer } from "./portal/server.ts"
import { gatehouseLog } from "./log.ts"
import { gatehousePackageRoot } from "./setup/package.ts"

const packageRoot = gatehousePackageRoot(import.meta.dir)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function eventType(event: unknown) {
  return isRecord(event) && typeof event.type === "string" ? event.type : undefined
}

function eventSessionId(event: unknown) {
  if (!isRecord(event)) return undefined
  if (typeof event.sessionID === "string") return event.sessionID
  if (isRecord(event.properties) && typeof event.properties.sessionID === "string") return event.properties.sessionID
  return undefined
}

function eventStatusType(event: unknown) {
  if (!isRecord(event)) return undefined
  if (isRecord(event.properties) && isRecord(event.properties.status) && typeof event.properties.status.type === "string") {
    return event.properties.status.type
  }
  return undefined
}

function blockedTaskSubagent(args: unknown) {
  if (!isRecord(args) || typeof args.subagent_type !== "string") return
  const subagent = args.subagent_type.trim()
  if (subagent === ARCHITECT_OPENCODE || subagent === LEAD_OPENCODE) {
    return subagent
  }
}

export default {
  id: "gatehouse.core",
  server: async (input: PluginInput): Promise<Hooks> => {
    const projectPrepared = process.env.GATEHOUSE_PROJECT_PREPARED === "1"
    if (!projectPrepared) {
      await syncManagedTemplates(input.directory)
      await scaffoldGatehouse(input.directory)
      await ensureOpencodeConfig(input.directory, packageRoot).catch(() => undefined)
    }
    const registry = await getRegistryStore(input)
    void resumeOrchestrationForRunningMissions(input, registry).catch((error: unknown) => {
      gatehouseLog(
        "error",
        `orchestration startup resume failed: ${error instanceof Error ? error.message : String(error)}`,
        { projectDirectory: input.directory, title: "Orchestration" },
      )
    })
    const flushInterval = setInterval(() => {
      void registry.flushPendingDeliveries()
    }, 15_000)
    flushInterval.unref?.()
    const watchdog = loadGatehouseConfig(input.directory).watchdog
    startMissionWatchdog(input, registry, watchdog)
    startRecordWatchdogs(input, registry, watchdog.record)
    startAutopilotWatchdog(input, registry, watchdog.autopilot)
    if (process.env.GATEHOUSE_PORTAL !== "0") {
      queueMicrotask(() => {
        void ensurePortalServer(input.directory, packageRoot).catch((error: unknown) => {
          if (error instanceof PortalPortInUseError) {
            notifyPortalPortInUse(input.directory, error)
          }
        })
      })
    }

    return {
      config: async (cfg) => {
        await applyGatehouseConfig(cfg, input.directory)
      },
      event: async (eventInput) => {
        const type = eventType(eventInput.event)
        if (type === "session.status" && eventStatusType(eventInput.event) === "idle") {
          await registry.flushPendingDeliveries()
        }
        const properties = permissionEventProperties(eventInput.event)
        if (type === "permission.asked" && properties) {
          const arbiter = await getPermissionArbiter(input, registry)
          await arbiter.handlePermissionAsked(properties).catch(() => undefined)
          return
        }
        if (type === "permission.replied" && properties) {
          const arbiter = await getPermissionArbiter(input, registry)
          await arbiter.handlePermissionReplied(properties).catch(() => undefined)
        }
        if (type === "server.instance.disposed") {
          const disposed = permissionEventProperties(eventInput.event)
          if (!disposed || typeof disposed.directory !== "string") return
          const arbiter = await getPermissionArbiter(input, registry)
          await arbiter.handleInstanceDisposed(disposed.directory).catch(() => undefined)
        }
      },
      "chat.message": async (messageInput) => {
        await handleOuterChatMessage(registry, messageInput)
        const registeredLead = registry.byProfile(LEAD_OPENCODE, "outer")
        if (registeredLead && messageInput.sessionID === registeredLead.sessionId) {
          await onLeadSessionUserMessage(input.directory)
        }
      },
      "tool.execute.before": async (hookInput, output) => {
        if (hookInput.tool !== "task") return
        const blocked = blockedTaskSubagent(output.args)
        if (!blocked) return
        const names = readAgentNamesSync(input.directory)
        const blockedName = blocked === ARCHITECT_OPENCODE ? names.architect : names.lead
        const hint =
          blocked === ARCHITECT_OPENCODE
            ? `Have ${names.lead} fill missions.yaml and call gatehouse_mission_start (${names.architect} is notified automatically; do not restate kickoff via send_message)`
            : `Use gatehouse_send_message(recipient="lead", message=...) to deliver via registry`
        throw new Error(`Gatehouse blocks OpenCode task sub-sessions to start ${blockedName}. ${hint}`)
      },
      tool: createGatehouseCoreTools(input),
    }
  },
}

export { GATEHOUSE_OUTER_AGENTS }
