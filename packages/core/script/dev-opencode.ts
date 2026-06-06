#!/usr/bin/env bun
/**
 * Launch OpenCode for an arbitrary project directory with Gatehouse core auto-setup.
 *
 * Usage (from gatehouse repo root):
 *   bun run dev /path/to/project
 *   bun run dev /path/to/project --port 4096
 *
 * Requires OpenCode >= 1.14.40:
 *   - Default: `opencode` on PATH
 *   - Optional: OPENCODE_ROOT=/path/to/opencode (source checkout)
 *   - Optional: OPENCODE_BIN=custom-opencode
 *
 * Also starts Gatehouse Portal via portal-stack (disable with GATEHOUSE_PORTAL=0).
 * Portal stack logs go to <project>/.gatehouse/logs/portal-stack.log (override with
 * GATEHOUSE_PORTAL_LOG=/path/to.log, or GATEHOUSE_PORTAL_LOG=inherit for terminal output).
 * Dev orchestration / shutdown logs go to <project>/.gatehouse/logs/dev-opencode.log
 * (override with GATEHOUSE_DEV_LOG=/path/to.log, or GATEHOUSE_DEV_LOG=inherit for terminal output).
 */
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import path from "node:path"
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "../src/portal/defaults.ts"
import {
  assertPortalPortAvailable,
  notifyPortalPortInUse,
  PortalPortInUseError,
} from "../src/portal/ports.ts"
import { ensureGlobalOpencodeTuiDev } from "../src/setup/global-opencode.ts"
import { prepareGatehouseProject } from "../src/setup/project.ts"

const coreRoot = path.resolve(import.meta.dir, "..")
const portalRoot = path.resolve(coreRoot, "../portal")
const opencodeRoot = process.env.OPENCODE_ROOT?.trim()
const opencodeBin = process.env.OPENCODE_BIN?.trim() || "opencode"

const networkFlags = new Set(["--port", "-p", "--hostname", "--mdns-domain"])

function localDevEnv(extra: Record<string, string | undefined>) {
  return {
    ...process.env,
    ...extra,
    NO_PROXY: "127.0.0.1,localhost,127.*,[::1]",
    no_proxy: "127.0.0.1,localhost,127.*,[::1]",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    http_proxy: "",
    https_proxy: "",
  }
}

function parseDevArgs(argv: string[]) {
  const tokens = argv.slice(2)
  const opencodeArgs: string[] = []
  let project: string | undefined
  let opencodePort = process.env.OPENCODE_PORT ?? "4096"

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === "--port" || token === "-p") {
      opencodeArgs.push(token)
      if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith("-")) {
        opencodePort = tokens[++i]!
        opencodeArgs.push(opencodePort)
      }
      continue
    }
    if (token.startsWith("-")) {
      opencodeArgs.push(token)
      if (networkFlags.has(token) && i + 1 < tokens.length && !tokens[i + 1]!.startsWith("-")) {
        opencodeArgs.push(tokens[++i]!)
      }
      continue
    }
    if (!project) {
      project = token
      continue
    }
    opencodeArgs.push(token)
  }

  return {
    projectDir: path.resolve(project ?? process.cwd()),
    opencodeArgs,
    opencodePort,
  }
}

function portalStackEnv(projectDir: string, opencodePort: string) {
  const portalApiPort = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  return localDevEnv({
    GATEHOUSE_PROJECT_DIR: projectDir,
    OPENCODE_PORT: opencodePort,
    GATEHOUSE_PORTAL_PORT: portalApiPort,
    GATEHOUSE_PORTAL_API: process.env.GATEHOUSE_PORTAL_API ?? `http://127.0.0.1:${portalApiPort}`,
  })
}

function portalStackLogPath(projectDir: string) {
  return path.join(projectDir, ".gatehouse", "logs", "portal-stack.log")
}

function devLogPath(projectDir: string) {
  const override = process.env.GATEHOUSE_DEV_LOG?.trim()
  if (override && override !== "inherit") return override
  return path.join(projectDir, ".gatehouse", "logs", "dev-opencode.log")
}

type DevLogTarget = { mode: "inherit" } | { mode: "file"; logPath: string; fd: number }

function openDevLogTarget(projectDir: string): DevLogTarget {
  const override = process.env.GATEHOUSE_DEV_LOG?.trim()
  if (override === "inherit") return { mode: "inherit" }
  const logPath = devLogPath(projectDir)
  mkdirSync(path.dirname(logPath), { recursive: true })
  const fd = openSync(logPath, "a")
  writeSync(fd, `\n--- dev-opencode ${new Date().toISOString()} ---\n`)
  return { mode: "file", logPath, fd }
}

function devLog(target: DevLogTarget, message: string) {
  if (target.mode === "inherit") {
    console.log(message)
    return
  }
  writeSync(target.fd, `${new Date().toISOString()} ${message}\n`)
}

function portalStackLogTarget(projectDir: string) {
  const override = process.env.GATEHOUSE_PORTAL_LOG?.trim()
  if (override === "inherit") return { mode: "inherit" as const }
  const logPath = override || portalStackLogPath(projectDir)
  mkdirSync(path.dirname(logPath), { recursive: true })
  const fd = openSync(logPath, "a")
  writeSync(fd, `\n--- portal-stack ${new Date().toISOString()} ---\n`)
  return { mode: "file" as const, logPath, fd }
}

async function shouldSpawnPortalStack(projectDir: string) {
  if (process.env.GATEHOUSE_PORTAL === "0") return false

  const displayPort = Number(process.env.GATEHOUSE_PORTAL_PORT ?? DEFAULT_PORTAL_DISPLAY_PORT)
  const adminPort = Number(process.env.GATEHOUSE_PORTAL_ADMIN_PORT ?? DEFAULT_PORTAL_ADMIN_PORT)
  try {
    await assertPortalPortAvailable(displayPort, "display")
    await assertPortalPortAvailable(adminPort, "admin")
    return true
  } catch (error) {
    if (error instanceof PortalPortInUseError) {
      notifyPortalPortInUse(projectDir, error)
      devLog(devLogTarget, error.message)
      devLog(devLogTarget, "[gatehouse] Reusing existing Portal — skipping portal-stack startup")
      return false
    }
    throw error
  }
}

function spawnPortalStack(projectDir: string, opencodePort: string) {
  if (process.env.GATEHOUSE_PORTAL === "0") return undefined

  const portalCommand =
    process.env.GATEHOUSE_PORTAL_UI === "0" || process.env.GATEHOUSE_PORTAL_VITE_DEV === "0" ? "api" : "start"
  const logTarget = portalStackLogTarget(projectDir)

  const proc = Bun.spawn(["bun", "script/portal-stack.ts", portalCommand], {
    cwd: portalRoot,
    env: portalStackEnv(projectDir, opencodePort),
    stdout: logTarget.mode === "inherit" ? "inherit" : logTarget.fd,
    stderr: logTarget.mode === "inherit" ? "inherit" : logTarget.fd,
  })

  if (logTarget.mode === "file") closeSync(logTarget.fd)
  return proc
}

let stopPortalStackTask: Promise<void> | undefined

function portalStopIo(target: DevLogTarget) {
  if (target.mode === "inherit") {
    return { stdout: "inherit" as const, stderr: "inherit" as const }
  }
  return { stdout: target.fd, stderr: target.fd }
}

async function stopPortalStack(
  proc: ReturnType<typeof Bun.spawn> | undefined,
  projectDir: string,
  opencodePort: string,
) {
  if (process.env.GATEHOUSE_PORTAL === "0") return
  if (stopPortalStackTask) return stopPortalStackTask

  stopPortalStackTask = (async () => {
    devLog(devLogTarget, "[gatehouse] Stopping Portal…")

    if (proc && proc.exitCode === null) {
      proc.kill("SIGTERM")
      await Promise.race([proc.exited, Bun.sleep(300)])
    }

    const stopProc = Bun.spawn(["bun", "script/portal-stack.ts", "stop"], {
      cwd: portalRoot,
      env: {
        ...portalStackEnv(projectDir, opencodePort),
        GATEHOUSE_PORTAL_FAST_STOP: "1",
      },
      ...portalStopIo(devLogTarget),
    })

    const finished = await Promise.race([stopProc.exited, Bun.sleep(2500).then(() => null)])
    if (finished === null && stopProc.exitCode === null) {
      devLog(devLogTarget, "[gatehouse] Portal stop timed out — forcing shutdown…")
      stopProc.kill("SIGKILL")
      await stopProc.exited.catch(() => undefined)
    }
  })()

  return stopPortalStackTask
}

function gatehousePluginEnv(projectDir: string, opencodePort: string) {
  const portalApiPort = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  return localDevEnv({
    GATEHOUSE_PROJECT_DIR: projectDir,
    OPENCODE_URL: `http://127.0.0.1:${opencodePort}`,
    GATEHOUSE_CORE_PLUGIN: path.join(coreRoot, "src/server.ts"),
    GATEHOUSE_DEV: "1",
    GATEHOUSE_LOCAL_PLUGIN: "1",
    GATEHOUSE_PROJECT_PREPARED: "1",
    // Dev always uses portal-stack or an already-running Portal — never in-process Vite inside OpenCode.
    GATEHOUSE_PORTAL: "0",
    GATEHOUSE_PORTAL_PORT: portalApiPort,
    GATEHOUSE_PORTAL_API: process.env.GATEHOUSE_PORTAL_API ?? `http://127.0.0.1:${portalApiPort}`,
  })
}

function spawnOpencode(projectDir: string, opencodeArgs: string[], opencodePort: string) {
  const env = gatehousePluginEnv(projectDir, opencodePort)

  if (opencodeRoot) {
    return Bun.spawn(
      ["bun", "run", "--conditions=browser", "src/index.ts", projectDir, ...opencodeArgs],
      {
        cwd: opencodeRoot,
        env,
        stdio: ["inherit", "inherit", "inherit"],
      },
    )
  }

  return Bun.spawn([opencodeBin, projectDir, ...opencodeArgs], {
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
}

const { projectDir, opencodeArgs, opencodePort } = parseDevArgs(process.argv)
const devLogTarget = openDevLogTarget(projectDir)

process.env.GATEHOUSE_DEV = "1"
process.env.GATEHOUSE_LOCAL_PLUGIN = "1"
await prepareGatehouseProject(projectDir, coreRoot)
await ensureGlobalOpencodeTuiDev(coreRoot)

process.env.GATEHOUSE_CORE_PLUGIN = path.join(coreRoot, "src/server.ts")
process.env.GATEHOUSE_PROJECT_DIR = projectDir
process.env.OPENCODE_URL = `http://127.0.0.1:${opencodePort}`

const portalStack = (await shouldSpawnPortalStack(projectDir))
  ? spawnPortalStack(projectDir, opencodePort)
  : undefined

let opencodeProc: ReturnType<typeof Bun.spawn> | undefined
let shutdownTask: Promise<void> | undefined

function requestShutdown(exitCode: number) {
  if (shutdownTask) return shutdownTask
  shutdownTask = runShutdown(exitCode)
  return shutdownTask
}

function closeDevLogTarget() {
  if (devLogTarget.mode === "file") closeSync(devLogTarget.fd)
}

async function runShutdown(exitCode: number) {
  if (opencodeProc && opencodeProc.exitCode === null) {
    opencodeProc.kill("SIGTERM")
    await Promise.race([opencodeProc.exited, Bun.sleep(500)])
  }
  await stopPortalStack(portalStack, projectDir, opencodePort)
  closeDevLogTarget()
  process.exit(exitCode)
}

function onShutdownSignal(signal: "SIGINT" | "SIGTERM", exitCode: number) {
  if (shutdownTask) {
    process.exit(exitCode)
    return
  }
  devLog(devLogTarget, `[gatehouse] Received ${signal}, shutting down…`)
  void requestShutdown(exitCode)
}

process.on("SIGINT", () => onShutdownSignal("SIGINT", 130))
process.on("SIGTERM", () => onShutdownSignal("SIGTERM", 143))

if (!opencodeRoot) {
  const which = Bun.spawnSync(["which", opencodeBin], { stdout: "pipe", stderr: "ignore" })
  if (which.exitCode !== 0) {
    console.error(
      `[gatehouse] OpenCode CLI not found (${opencodeBin}). Install OpenCode >= 1.14.40, or set OPENCODE_ROOT to an opencode source checkout.`,
    )
    process.exit(1)
  }
}

opencodeProc = spawnOpencode(projectDir, opencodeArgs, opencodePort)

const exitCode = await opencodeProc.exited
if (!shutdownTask) {
  devLog(devLogTarget, "[gatehouse] OpenCode exited — cleaning up…")
}
await requestShutdown(exitCode === 0 ? 0 : exitCode || 1)
