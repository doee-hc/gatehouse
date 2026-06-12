import type { GatehouseLocale } from "../locale.ts"
import type { MissionScriptMeta, PromptInput } from "./types.ts"
import type { TeamSpec } from "../tree/types.ts"

export type SandboxInitMessage = {
  type: "init"
  orchestrateSource: string
  missionId: string
  locale: GatehouseLocale
  team: TeamSpec
  objective?: string
  meta?: MissionScriptMeta
}

export type SandboxRpcRequest = {
  type: "rpc"
  id: string
  op:
    | "prompt"
    | "setBrief"
    | "readMissionContext"
    | "readContract"
    | "waitFor"
    | "waitForAll"
    | "waitForRollup"
    | "phase"
    | "log"
  nodeIds?: string[]
  nodeId?: string
  input?: PromptInput
  partial?: {
    your_work?: string[]
    not_your_job?: string[]
    acceptance_slice?: string[]
    role?: string
  }
  view?: "summary" | "full"
  event?: "complete"
  timeout?: string
  rootNodeId?: string
  title?: string
  message?: string
}

export type SandboxRpcResponse = {
  type: "rpc-response"
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export type SandboxDoneMessage = {
  type: "done"
}

export type SandboxErrorMessage = {
  type: "error"
  message: string
}

export type SandboxWorkerInbound = SandboxInitMessage
export type SandboxWorkerOutbound = SandboxRpcRequest | SandboxDoneMessage | SandboxErrorMessage
export type SandboxHostInbound = SandboxRpcRequest | SandboxDoneMessage | SandboxErrorMessage
export type SandboxHostOutbound = SandboxRpcResponse
