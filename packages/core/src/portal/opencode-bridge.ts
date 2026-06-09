import { runOpencodeEventLoop } from "../channels/opencode/events.ts"
import { gatehouseLog } from "../log.ts"
import { agentSync } from "./agent-sync.ts"

type BridgeState = {
  projectDirectory: string
  opencodeUrl: string
  abort: AbortController
  loop: Promise<void>
}

let activeBridge: BridgeState | undefined

function opencodeUrlFromEnv() {
  return process.env.OPENCODE_URL ?? process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096"
}

export function isOpencodeBridgeRunning() {
  return activeBridge !== undefined
}

export async function ensureOpencodeBridge(projectDirectory: string, opencodeUrl = opencodeUrlFromEnv()) {
  if (activeBridge?.projectDirectory === projectDirectory && activeBridge.opencodeUrl === opencodeUrl) {
    return
  }

  stopOpencodeBridge()
  const abort = new AbortController()
  const sync = agentSync(projectDirectory)
  await sync.refreshIndex(opencodeUrl).catch(() => undefined)

  const loop = runOpencodeEventLoop({
    opencodeUrl,
    projectDir: projectDirectory,
    signal: abort.signal,
    onEvent: (event) => {
      void sync.handleOpencodeEvent(event, opencodeUrl)
    },
  }).catch((error) => {
    if (abort.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    gatehouseLog("warn", `[gatehouse/portal] OpenCode bridge stopped: ${message}`, {
      projectDirectory,
      title: "Portal",
    })
  })

  activeBridge = { projectDirectory, opencodeUrl, abort, loop }
  gatehouseLog("info", `[gatehouse/portal] OpenCode bridge started`, {
    projectDirectory,
    title: "Portal",
  })
}

export function stopOpencodeBridge() {
  if (!activeBridge) return
  activeBridge.abort.abort()
  activeBridge = undefined
}

export function resetOpencodeBridgeForTests() {
  stopOpencodeBridge()
}
