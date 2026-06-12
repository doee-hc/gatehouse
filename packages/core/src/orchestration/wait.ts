import type { OrchestrationState } from "./types.ts"
import { allNodesCompleteForWait, nodeIsCompleteForWait } from "./state.ts"

type WaitKind = "complete"

type WaitHandle = {
  missionId: string
  nodeIds: string[]
  kind: WaitKind
  resolve: () => void
  reject: (error: Error) => void
  timeout?: ReturnType<typeof setTimeout>
}

const waitsByMission = new Map<string, WaitHandle[]>()

function parseTimeoutMs(timeout?: string) {
  if (!timeout) return undefined
  const match = /^(\d+)(ms|s|m|h)$/.exec(timeout.trim())
  if (!match) return undefined
  const value = Number(match[1])
  const unit = match[2]
  if (unit === "ms") return value
  if (unit === "s") return value * 1000
  if (unit === "m") return value * 60_000
  if (unit === "h") return value * 3_600_000
  return undefined
}

function isSatisfied(handle: WaitHandle, state: OrchestrationState) {
  if (handle.kind === "complete") {
    if (handle.nodeIds.length === 1) {
      const nodeId = handle.nodeIds[0]
      return nodeId !== undefined && nodeIsCompleteForWait(state, nodeId)
    }
    return allNodesCompleteForWait(state, handle.nodeIds)
  }
  return false
}

function flushMissionWaits(missionId: string, state: OrchestrationState) {
  const pending = waitsByMission.get(missionId)
  if (!pending?.length) return
  const remaining: WaitHandle[] = []
  for (const handle of pending) {
    if (isSatisfied(handle, state)) {
      if (handle.timeout) clearTimeout(handle.timeout)
      handle.resolve()
    } else {
      remaining.push(handle)
    }
  }
  if (remaining.length) waitsByMission.set(missionId, remaining)
  else waitsByMission.delete(missionId)
}

export function notifyOrchestrationWaiters(missionId: string, state: OrchestrationState) {
  flushMissionWaits(missionId, state)
}

export function waitForOrchestration(
  missionId: string,
  nodeIds: string[],
  kind: WaitKind,
  opts?: { timeout?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle: WaitHandle = {
      missionId,
      nodeIds,
      kind,
      resolve,
      reject,
    }
    const ms = parseTimeoutMs(opts?.timeout)
    if (ms !== undefined) {
      handle.timeout = setTimeout(() => {
        reject(new Error(`waitFor timeout after ${opts?.timeout} for ${nodeIds.join(", ")}`))
      }, ms)
    }
    const list = waitsByMission.get(missionId) ?? []
    list.push(handle)
    waitsByMission.set(missionId, list)
  })
}

export function clearMissionWaits(missionId: string) {
  const pending = waitsByMission.get(missionId)
  if (!pending) return
  for (const handle of pending) {
    if (handle.timeout) clearTimeout(handle.timeout)
    handle.reject(new Error(`orchestration waits cleared for mission ${missionId}`))
  }
  waitsByMission.delete(missionId)
}
