import path from "node:path"
import {
  buildBridgeEnv,
  listEnabledChannels,
  loadChannelsConfig,
  validateChannelReady,
} from "./config.ts"
import { resolveBridgeEntry } from "./resolve-bridge.ts"
import { consumeSupervisorControl } from "./control.ts"
import {
  clearSupervisorState,
  isProcessAlive,
  readLiveSupervisorState,
  readSupervisorState,
  writeSupervisorState,
} from "./state.ts"
import type { ChannelId, ChannelProcessState, SupervisorState } from "./types.ts"

const RESTART_DELAY_MS = 3_000
const MAX_RAPID_RESTARTS = 8
const RAPID_RESTART_WINDOW_MS = 120_000

type ManagedChild = {
  channelId: ChannelId
  proc: Subprocess
  restarts: number
  restartTimestamps: number[]
  intentionalStop?: boolean
}

type Subprocess = ReturnType<typeof Bun.spawn>

function prefixLines(channelId: ChannelId, stream: "out" | "err", chunk: Uint8Array | string) {
  const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const target = stream === "err" ? process.stderr : process.stdout
    target.write(`[${channelId}] ${line}\n`)
  }
}

function attachPrefixedOutput(channelId: ChannelId, proc: Subprocess) {
  const attach = (stream: ReadableStream<Uint8Array> | undefined, target: "out" | "err") => {
    if (!stream) return
    void (async () => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) prefixLines(channelId, target, value)
        }
      } catch {
        // stream closed
      }
    })()
  }
  attach(proc.stdout as ReadableStream<Uint8Array> | undefined, "out")
  attach(proc.stderr as ReadableStream<Uint8Array> | undefined, "err")
}

function emptyChannelState(status: ChannelProcessState["status"], patch?: Partial<ChannelProcessState>): ChannelProcessState {
  return {
    status,
    restarts: 0,
    ...patch,
  }
}

export class ChannelSupervisor {
  private readonly children = new Map<ChannelId, ManagedChild>()
  private stopping = false
  private state: SupervisorState

  constructor(
    private readonly projectDir: string,
    private readonly requestedChannels?: ChannelId[],
  ) {
    const config = loadChannelsConfig(projectDir)
    this.state = {
      pid: process.pid,
      projectDir,
      startedAt: Date.now(),
      opencodeUrl: config.opencodeUrl,
      channels: {},
    }
  }

  async start() {
    const recorded = readSupervisorState(this.projectDir)
    if (recorded?.pid && !isProcessAlive(recorded.pid)) {
      clearSupervisorState(this.projectDir)
    }

    const existing = readLiveSupervisorState(this.projectDir)
    if (existing && existing.pid !== process.pid) {
      throw new Error(`Supervisor is already running (pid ${existing.pid}) — run bunx @gatehouse/core channels stop first`)
    }

    const config = loadChannelsConfig(this.projectDir)
    const enabled = listEnabledChannels(config, this.requestedChannels)
    if (!enabled.length) {
      throw new Error("No channels enabled. Edit .gatehouse/channels.yaml or run bunx @gatehouse/core channels login <name>")
    }

    writeSupervisorState(this.projectDir, this.state)
    this.installSignalHandlers()

    console.log(`Gatehouse Channels Supervisor started (pid ${process.pid})`)
    console.log(`  Project: ${this.projectDir}`)
    console.log(`  OpenCode: ${config.opencodeUrl}`)
    console.log(`  Channels: ${enabled.join(", ")}`)

    for (const channelId of enabled) {
      await this.startChannel(channelId)
    }

    await this.waitForShutdown()
  }

  private installSignalHandlers() {
    const shutdown = async (signal: NodeJS.Signals) => {
      if (this.stopping) return
      this.stopping = true
      console.log(`\n[supervisor] Received ${signal}, shutting down…`)
      await this.stopAll()
      process.exit(0)
    }
    process.on("SIGINT", () => void shutdown("SIGINT"))
    process.on("SIGTERM", () => void shutdown("SIGTERM"))
  }

  private async waitForShutdown() {
    while (!this.stopping) {
      const control = consumeSupervisorControl(this.projectDir)
      if (control) {
        await this.handleControl(control.action, control.channelId)
      }
      writeSupervisorState(this.projectDir, this.state)
      await Bun.sleep(1000)
    }
  }

  private async handleControl(action: "start_channel" | "stop_channel", channelId: ChannelId) {
    if (action === "stop_channel") {
      await this.stopChannel(channelId)
      return
    }
    if (this.children.has(channelId)) return
    const runtime = this.state.channels[channelId]
    if (runtime?.status === "running" || runtime?.status === "starting") return
    await this.startChannel(channelId)
  }

  private async stopChannel(channelId: ChannelId) {
    const managed = this.children.get(channelId)
    if (managed) {
      managed.intentionalStop = true
      if (managed.proc.pid && isProcessAlive(managed.proc.pid)) {
        try {
          managed.proc.kill("SIGTERM")
        } catch {
          // ignore
        }
      }
      this.children.delete(channelId)
    }
    this.updateChannelState(channelId, {
      status: "stopped",
      stoppedAt: Date.now(),
      pid: undefined,
      lastError: undefined,
    })
  }

  private updateChannelState(channelId: ChannelId, patch: Partial<ChannelProcessState>) {
    const current = this.state.channels[channelId] ?? emptyChannelState("stopped")
    this.state.channels[channelId] = { ...current, ...patch }
    writeSupervisorState(this.projectDir, this.state)
  }

  private searchDirs() {
    return [this.projectDir, process.cwd(), path.dirname(import.meta.dir)]
  }

  private async startChannel(channelId: ChannelId) {
    const config = loadChannelsConfig(this.projectDir)
    const ready = validateChannelReady(this.projectDir, channelId, config)
    if (!ready.ok) {
      this.updateChannelState(channelId, {
        status: "failed",
        lastError: ready.reason,
        stoppedAt: Date.now(),
      })
      console.error(`[supervisor] Skipping ${channelId}: ${ready.reason}`)
      return
    }

    const entry = resolveBridgeEntry(channelId, this.searchDirs())
    const env = {
      ...process.env,
      ...buildBridgeEnv(this.projectDir, config, channelId),
    }

    this.updateChannelState(channelId, {
      status: "starting",
      startedAt: Date.now(),
      lastError: undefined,
    })

    const proc = Bun.spawn(["bun", entry], {
      env,
      cwd: this.projectDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    attachPrefixedOutput(channelId, proc)

    const managed: ManagedChild = {
      channelId,
      proc,
      restarts: this.state.channels[channelId]?.restarts ?? 0,
      restartTimestamps: [],
    }
    this.children.set(channelId, managed)

    this.updateChannelState(channelId, {
      pid: proc.pid,
      status: "running",
      restarts: managed.restarts,
      startedAt: Date.now(),
    })

    void this.watchChild(managed)
  }

  private shouldRestart(managed: ManagedChild) {
    const now = Date.now()
    managed.restartTimestamps = managed.restartTimestamps.filter((ts) => now - ts < RAPID_RESTART_WINDOW_MS)
    managed.restartTimestamps.push(now)
    return managed.restartTimestamps.length <= MAX_RAPID_RESTARTS
  }

  private async watchChild(managed: ManagedChild) {
    const code = await managed.proc.exited
    if (this.stopping) return

    if (managed.intentionalStop) {
      this.updateChannelState(managed.channelId, {
        status: "stopped",
        stoppedAt: Date.now(),
        pid: undefined,
      })
      return
    }

    const message = `bridge exited (code ${code})`
    managed.restarts += 1

    if (!this.shouldRestart(managed)) {
      this.updateChannelState(managed.channelId, {
        status: "failed",
        restarts: managed.restarts,
        lastError: `${message}; too many restarts, stopped`,
        stoppedAt: Date.now(),
        pid: undefined,
      })
      console.error(`[supervisor] ${managed.channelId} ${message}; giving up on restart`)
      return
    }

    this.updateChannelState(managed.channelId, {
      status: "starting",
      restarts: managed.restarts,
      lastError: message,
      pid: undefined,
    })
    console.error(`[supervisor] ${managed.channelId} ${message}; restarting in ${RESTART_DELAY_MS / 1000}s…`)
    await Bun.sleep(RESTART_DELAY_MS)
    if (this.stopping) return
    this.children.delete(managed.channelId)
    await this.startChannel(managed.channelId)
  }

  private async stopAll() {
    for (const managed of this.children.values()) {
      if (managed.proc.pid && isProcessAlive(managed.proc.pid)) {
        try {
          managed.proc.kill("SIGTERM")
        } catch {
          // ignore
        }
      }
      this.updateChannelState(managed.channelId, {
        status: "stopped",
        stoppedAt: Date.now(),
        pid: undefined,
      })
    }
    this.children.clear()
    clearSupervisorState(this.projectDir)
  }
}

export async function runChannelSupervisor(projectDir: string, channels?: ChannelId[]) {
  const supervisor = new ChannelSupervisor(projectDir, channels)
  await supervisor.start()
}
