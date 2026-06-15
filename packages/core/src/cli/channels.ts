import {
  buildChannelList,
  CHANNEL_IDS,
  formatDoctorReport,
  initChannelsConfig,
  readLiveSupervisorState,
  resolveProjectDir,
  runChannelLogin,
  runChannelSupervisor,
  runChannelsDoctor,
  stopSupervisorProcess,
  type ChannelId,
} from "../channels/index.ts"

type ParsedArgs = {
  projectDir?: string
  flags: Set<string>
  positional: string[]
}

function printChannelsHelp() {
  console.log(`Invoke: bunx @gatehouse/core channels <subcommand>
       (or gatehouse channels <subcommand> after bun install -g @gatehouse/core)

Usage:
  bunx @gatehouse/core channels init [-C project]
  bunx @gatehouse/core channels list [-C project]
  bunx @gatehouse/core channels doctor [-C project] [--probe]
  bunx @gatehouse/core channels login <weixin|feishu|qq|qq-onebot> [-C project]
  bunx @gatehouse/core channels serve [-C project] [weixin feishu qq qq-onebot ...]
  bunx @gatehouse/core channels stop [-C project]
  bunx @gatehouse/core channels status [-C project]

Options:
  -C, --project <dir>   Gatehouse project root (default: current directory)
  --probe               Probe OpenCode connectivity during doctor/status

Examples:
  bunx @gatehouse/core channels init
  bunx @gatehouse/core channels login weixin
  bunx @gatehouse/core channels serve
  bunx @gatehouse/core channels serve weixin feishu
  bunx @gatehouse/core channels doctor --probe
`)
}

function parseArgs(args: string[]): ParsedArgs {
  const flags = new Set<string>()
  const positional: string[] = []
  let projectDir: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-C" || arg === "--project") {
      const next = args[++i]
      if (!next) throw new Error(`${arg} requires a project path`)
      projectDir = next
      continue
    }
    if (arg.startsWith("-")) {
      flags.add(arg)
      continue
    }
    positional.push(arg)
  }

  return { projectDir, flags, positional }
}

function parseChannelNames(values: string[]): ChannelId[] {
  const ids: ChannelId[] = []
  for (const value of values) {
    if (!CHANNEL_IDS.includes(value as ChannelId)) {
      throw new Error(`Unknown channel: ${value} (options: ${CHANNEL_IDS.join(", ")})`)
    }
    ids.push(value as ChannelId)
  }
  return ids
}

function formatRuntimeTag(status?: string) {
  if (!status) return "idle"
  return status
}

export async function runChannelsCommand(rawArgs: string[]) {
  const { projectDir: projectFlag, flags, positional } = parseArgs(rawArgs)
  const command = positional[0] ?? "help"

  if (command === "help" || flags.has("--help") || flags.has("-h")) {
    printChannelsHelp()
    return
  }

  const needsProject = command !== "help"
  const projectDir = needsProject ? resolveProjectDir(process.cwd(), projectFlag) : undefined
  const searchDirs = projectDir ? [projectDir, process.cwd()] : [process.cwd()]

  switch (command) {
    case "init": {
      const result = initChannelsConfig(projectDir!)
      if (result.created) {
        console.log(`Created ${result.path}`)
        console.log("Edit enabled / credentials, then run: bunx @gatehouse/core channels serve")
      } else {
        console.log(`Already exists: ${result.path}`)
      }
      return
    }

    case "list": {
      const entries = buildChannelList(projectDir!)
      for (const entry of entries) {
        const tags = [
          entry.enabled ? "enabled" : "disabled",
          entry.configured ? "configured" : "missing-config",
          formatRuntimeTag(entry.runtime?.status),
        ]
        const pid = entry.runtime?.pid ? ` pid=${entry.runtime.pid}` : ""
        const err = entry.runtime?.lastError ? ` error="${entry.runtime.lastError}"` : ""
        console.log(`${entry.id}: ${tags.join(" ")}${pid}${err}`)
      }
      return
    }

    case "doctor": {
      const issues = await runChannelsDoctor(projectDir!, flags.has("--probe"))
      console.log(formatDoctorReport(issues))
      if (issues.some((issue) => issue.level === "error")) process.exitCode = 1
      return
    }

    case "login": {
      const channelId = positional[1]
      if (!channelId) throw new Error("Usage: bunx @gatehouse/core channels login <weixin|feishu|qq|qq-onebot>")
      if (!CHANNEL_IDS.includes(channelId as ChannelId)) {
        throw new Error(`Unknown channel: ${channelId}`)
      }
      initChannelsConfig(projectDir!)
      await runChannelLogin(projectDir!, channelId as ChannelId, searchDirs)
      return
    }

    case "serve": {
      initChannelsConfig(projectDir!)
      const channels = parseChannelNames(positional.slice(1))
      await runChannelSupervisor(projectDir!, channels.length ? channels : undefined)
      return
    }

    case "stop": {
      const result = await stopSupervisorProcess(projectDir!)
      if (result.stopped) {
        const forced = result.forced ? " (forced)" : ""
        console.log(`Supervisor stopped (pid ${result.pid})${forced}`)
      } else {
        console.log(result.reason)
      }
      return
    }

    case "status": {
      const supervisor = readLiveSupervisorState(projectDir!)
      if (!supervisor) {
        console.log("supervisor: stopped")
      } else {
        console.log(`supervisor: running pid=${supervisor.pid} since=${new Date(supervisor.startedAt).toISOString()}`)
        console.log(`  project: ${supervisor.projectDir}`)
        console.log(`  opencode: ${supervisor.opencodeUrl}`)
        for (const channelId of CHANNEL_IDS) {
          const runtime = supervisor.channels?.[channelId]
          if (!runtime) continue
          const pid = runtime.pid ? ` pid=${runtime.pid}` : ""
          const err = runtime.lastError ? ` lastError="${runtime.lastError}"` : ""
          console.log(`  ${channelId}: ${runtime.status} restarts=${runtime.restarts}${pid}${err}`)
        }
      }
      if (flags.has("--probe")) {
        const issues = await runChannelsDoctor(projectDir!, true)
        console.log("")
        console.log(formatDoctorReport(issues))
      }
      return
    }

    default:
      printChannelsHelp()
      process.exitCode = 1
  }
}
