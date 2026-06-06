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
  if (text.includes("没有启用的 channel")) {
    return "没有已启用的频道。请先在下方打开至少一个频道的「启用」开关。"
  }
  if (text.includes("supervisor 已在运行")) {
    return "Supervisor 已在运行"
  }
  if (text) return text.split("\n").filter(Boolean).at(-1) ?? text
  if (exitCode !== null) return `Supervisor 启动失败 (exit ${exitCode})`
  return "Supervisor 启动失败"
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
      reason: "没有已启用的频道。请先在下方打开至少一个频道的「启用」开关。",
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
    return { ok: false, reason: "无法启动 Supervisor 子进程" }
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
      if (stderr.includes("supervisor 已在运行")) {
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
    return { ok: false, reason: "Supervisor 仍在启动中，请稍后点击「刷新」查看状态" }
  }

  const exitCode = proc.pid !== undefined && !isProcessAlive(proc.pid) ? await proc.exited : null
  const stderr = await readStreamText(proc.stderr as ReadableStream<Uint8Array> | undefined)
  if (exitCode !== null) {
    return { ok: false, reason: normalizeSpawnError(stderr, exitCode) }
  }

  return { ok: false, reason: "Supervisor 启动超时，请稍后点击「刷新」查看状态" }
}
