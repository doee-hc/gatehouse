import fs from "node:fs"
import path from "node:path"
import { readCorePackageRoot } from "../paths.ts"
import { gatehouseRoot, listEnabledChannels, loadChannelsConfig } from "./config.ts"
import { clearSupervisorState, isProcessAlive, readLiveSupervisorState, readSupervisorState } from "./state.ts"
import type { ChannelId } from "./types.ts"

export function resolveGatehouseCliEntry(projectDir: string, fallbackPackageRoot?: string) {
  // Prefer the caller's package root (Portal API / live monorepo) over `.gatehouse/core.path`,
  // which may point at a stale packed install under /tmp.
  if (fallbackPackageRoot) {
    const cli = path.join(fallbackPackageRoot, "bin", "gatehouse.ts")
    if (fs.existsSync(cli)) return cli
  }
  const fromMarker = readCorePackageRoot(projectDir)
  if (fromMarker) {
    const cli = path.join(fromMarker, "bin", "gatehouse.ts")
    if (fs.existsSync(cli)) return cli
  }
  return "gatehouse"
}

export type SpawnSupervisorResult =
  | { ok: true; pid: number; alreadyRunning?: boolean }
  | { ok: false; reason: string }

async function readStreamText(stream: ReadableStream<Uint8Array> | null | undefined) {
  if (!stream) return ""
  try {
    return await new Response(stream).text()
  } catch {
    return ""
  }
}

function normalizeSpawnError(stderr: string, exitCode: number | null) {
  const text = stderr.trim()
  if (text.includes("No channels enabled")) {
    return "No channels enabled. Turn on at least one channel using the Enable toggle below."
  }
  if (text.includes("Supervisor is already running")) {
    return "Supervisor is already running"
  }
  if (text) return text.split("\n").filter(Boolean).at(-1) ?? text
  if (exitCode !== null) return `Supervisor failed to start (exit ${exitCode})`
  return "Supervisor failed to start"
}

function clearStaleSupervisorState(projectDir: string) {
  const state = readSupervisorState(projectDir)
  if (!state?.pid) {
    clearSupervisorState(projectDir)
    return
  }
  if (!isProcessAlive(state.pid)) {
    clearSupervisorState(projectDir)
  }
}

export async function spawnChannelSupervisor(
  projectDir: string,
  channels?: ChannelId[],
  fallbackPackageRoot?: string,
): Promise<SpawnSupervisorResult> {
  clearStaleSupervisorState(projectDir)

  const live = readLiveSupervisorState(projectDir)
  if (live) {
    return { ok: true, pid: live.pid, alreadyRunning: true }
  }

  const config = loadChannelsConfig(projectDir)
  const enabled = listEnabledChannels(config, channels)
  if (!enabled.length) {
    return {
      ok: false,
      reason: "No channels enabled. Turn on at least one channel using the Enable toggle below.",
    }
  }

  const cli = resolveGatehouseCliEntry(projectDir, fallbackPackageRoot)
  const args = [cli, "channels", "serve", ...enabled]

  const useBun = cli.endsWith(".ts") || cli.endsWith(".js")
  const command = useBun ? "bun" : cli
  const spawnArgs = useBun ? args : args.slice(1)

  const proc = Bun.spawn([command, ...spawnArgs], {
    cwd: projectDir,
    env: {
      ...process.env,
      GATEHOUSE_PROJECT_DIR: projectDir,
    },
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  })

  if (!proc.pid) {
    return { ok: false, reason: "Failed to spawn Supervisor child process" }
  }

  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    const running = readLiveSupervisorState(projectDir)
    if (running) {
      return { ok: true, pid: running.pid }
    }
    if (proc.pid !== undefined && !isProcessAlive(proc.pid)) {
      const exitCode = await proc.exited
      const stderr = await readStreamText(proc.stderr as ReadableStream<Uint8Array> | undefined)
      const late = readLiveSupervisorState(projectDir)
      if (late) {
        return { ok: true, pid: late.pid }
      }
      if (stderr.includes("Supervisor is already running")) {
        const existing = readLiveSupervisorState(projectDir)
        if (existing) {
          return { ok: true, pid: existing.pid, alreadyRunning: true }
        }
      }
      return { ok: false, reason: normalizeSpawnError(stderr, exitCode) }
    }
    await Bun.sleep(100)
  }

  const running = readLiveSupervisorState(projectDir)
  if (running) {
    return { ok: true, pid: running.pid }
  }

  if (proc.pid !== undefined && isProcessAlive(proc.pid)) {
    return { ok: false, reason: "Supervisor is still starting — click Refresh to check status" }
  }

  const exitCode = proc.pid !== undefined && !isProcessAlive(proc.pid) ? await proc.exited : null
  const stderr = await readStreamText(proc.stderr as ReadableStream<Uint8Array> | undefined)
  if (exitCode !== null) {
    return { ok: false, reason: normalizeSpawnError(stderr, exitCode) }
  }

  return { ok: false, reason: "Supervisor start timed out — click Refresh to check status" }
}
