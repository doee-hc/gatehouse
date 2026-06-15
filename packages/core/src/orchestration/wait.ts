import type { OrchestrationState } from "./types.ts"

type WaitKind = "complete"

type WaitHandle = {
  missionId: string
  nodeId: string
  kind: WaitKind
  resolve: () => void
  reject: (error: Error) => void
  timeout?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setInterval>
}

const waitsByMission = new Map<string, WaitHandle[]>()

export const ORCHESTRATION_WAIT_POLL_MS = 500

function nodeIsCompleteForWait(state: OrchestrationState, nodeId: string) {
  return state.nodes[nodeId]?.status === "done"
}

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

function removeHandle(missionId: string, handle: WaitHandle) {
  const pending = waitsByMission.get(missionId)
  if (!pending) return
  const remaining = pending.filter((entry) => entry !== handle)
  if (remaining.length) waitsByMission.set(missionId, remaining)
  else waitsByMission.delete(missionId)
}

function resolveHandle(handle: WaitHandle) {
  if (handle.timeout) clearTimeout(handle.timeout)
  if (handle.poll) clearInterval(handle.poll)
  removeHandle(handle.missionId, handle)
  handle.resolve()
}

export function flushMissionWaits(missionId: string, state: OrchestrationState) {
  const pending = waitsByMission.get(missionId)
  if (!pending?.length) return
  for (const handle of [...pending]) {
    if (nodeIsCompleteForWait(state, handle.nodeId)) resolveHandle(handle)
  }
}

export function notifyOrchestrationWaiters(missionId: string, state: OrchestrationState) {
  flushMissionWaits(missionId, state)
}

export function waitForOrchestration(
  missionId: string,
  nodeId: string,
  kind: WaitKind,
  opts: {
    readState: () => OrchestrationState | undefined
    timeout?: string
  },
): Promise<void> {
  const readState = opts.readState
  const initial = readState()
  if (initial && nodeIsCompleteForWait(initial, nodeId)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const handle: WaitHandle = {
      missionId,
      nodeId,
      kind,
      resolve,
      reject,
    }
    const ms = parseTimeoutMs(opts.timeout)
    if (ms !== undefined) {
      handle.timeout = setTimeout(() => {
        if (handle.poll) clearInterval(handle.poll)
        removeHandle(missionId, handle)
        reject(new Error(`waitFor timeout after ${opts.timeout} for ${nodeId}`))
      }, ms)
    }

    handle.poll = setInterval(() => {
      const fresh = readState()
      if (fresh && nodeIsCompleteForWait(fresh, nodeId)) resolveHandle(handle)
    }, ORCHESTRATION_WAIT_POLL_MS)
    handle.poll.unref?.()

    const list = waitsByMission.get(missionId) ?? []
    list.push(handle)
    waitsByMission.set(missionId, list)

    const afterRegister = readState()
    if (afterRegister && nodeIsCompleteForWait(afterRegister, nodeId)) resolveHandle(handle)
  })
}

export function clearMissionWaits(missionId: string) {
  const pending = waitsByMission.get(missionId)
  if (!pending) return
  for (const handle of pending) {
    if (handle.timeout) clearTimeout(handle.timeout)
    if (handle.poll) clearInterval(handle.poll)
    handle.reject(new Error(`orchestration waits cleared for mission ${missionId}`))
  }
  waitsByMission.delete(missionId)
}
