import path from "node:path"
import { resolveProjectDir } from "../channels/supervisor/config.ts"
import { readActiveMission } from "../portal/active-mission.ts"
import { RegistryStore } from "../registry/store.ts"
import {
  defaultOpencodeBaseUrl,
  gatehouseClientFromOpencode,
} from "../session/opencode-http-client.ts"
import { dumpMissionSessionsForDebug, type DumpMissionSessionsScope } from "../session/dump-mission-sessions.ts"

type ParsedArgs = {
  projectDir?: string
  missionId?: string
  scope: DumpMissionSessionsScope
  force: boolean
  opencodeUrl: string
}

function printDumpContextHelp() {
  console.log(`Invoke: bunx @gatehouse/core dump-context [options]
       (or gatehouse dump-context [options] after bun install -g @gatehouse/core)

Developer-only: pull OpenCode session history into local context files.
Gatehouse runtime does not read these dumps during missions.

Usage:
  bunx @gatehouse/core dump-context [-C project] [--mission <id>] [--inner|--outer|--all] [--force]

Options:
  -C, --project <dir>       Gatehouse project root (default: cwd)
  --mission <id>            Mission id (default: portal/active-mission.yaml)
  --inner                   Dump inner execution team to .gatehouse/missions/<id>/context/
  --outer                   Dump outer agents to .gatehouse/internal/debug/sessions/<id>/
  --all                     Dump inner and outer (default)
  --force                   Re-dump inner context even if index.json exists
  --opencode-url <url>      OpenCode HTTP base URL (default: OPENCODE_URL or http://127.0.0.1:4096)
  -h, --help                Show this help

Examples:
  bunx @gatehouse/core dump-context -C /path/to/project --mission agent-loop-research-001
  bunx @gatehouse/core dump-context --outer --mission m1
`)
}

function parseArgs(args: string[]): ParsedArgs | "help" {
  let projectDir: string | undefined
  let missionId: string | undefined
  let scope: DumpMissionSessionsScope = "all"
  let force = false
  let opencodeUrl = defaultOpencodeBaseUrl()

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-h" || arg === "--help") return "help"
    if (arg === "-C" || arg === "--project") {
      projectDir = args[++i]
      continue
    }
    if (arg === "--mission") {
      missionId = args[++i]
      continue
    }
    if (arg === "--inner") {
      scope = "inner"
      continue
    }
    if (arg === "--outer") {
      scope = "outer"
      continue
    }
    if (arg === "--all") {
      scope = "all"
      continue
    }
    if (arg === "--force") {
      force = true
      continue
    }
    if (arg === "--opencode-url") {
      opencodeUrl = args[++i] ?? opencodeUrl
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  return { projectDir, missionId, scope, force, opencodeUrl }
}

export async function runDumpContextCommand(args: string[]) {
  const parsed = parseArgs(args)
  if (parsed === "help") {
    printDumpContextHelp()
    return
  }

  const projectDir = resolveProjectDir(process.cwd(), parsed.projectDir)
  const missionId = parsed.missionId ?? (await readActiveMission(projectDir))
  if (!missionId) {
    throw new Error("missing --mission <id> and no portal/active-mission.yaml found")
  }

  const client = gatehouseClientFromOpencode({
    baseUrl: parsed.opencodeUrl,
    directory: projectDir,
  })
  const registry = await RegistryStore.create({ directory: projectDir, client })
  const result = await dumpMissionSessionsForDebug({
    client,
    projectDirectory: projectDir,
    missionId,
    registry,
    scope: parsed.scope,
    force: parsed.force,
  })

  console.log(JSON.stringify(result, null, 2))
}
