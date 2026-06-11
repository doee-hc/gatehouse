#!/usr/bin/env bun
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { registerGatehouseGlobal, printInstallHelp } from "./install.ts"
import { runGatehouseDoctorCli } from "./doctor.ts"
import { runChannelsCommand } from "./channels.ts"
import { runGatehouseScaffold, printScaffoldHelp } from "./scaffold.ts"
import { upgradeGatehouseGlobal, printUpgradeHelp } from "./upgrade.ts"
import { uninstallGatehouseGlobal, printUninstallHelp } from "./uninstall.ts"

const args = process.argv.slice(2)
const command = args[0] ?? "help"

async function runOrExit(fn: () => Promise<void>) {
  try {
    await fn()
    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[gatehouse] ${command} failed: ${message}`)
    process.exit(1)
  }
}

if (command === "channels") {
  await runChannelsCommand(args.slice(1))
  process.exit(process.exitCode ?? 0)
}

if (command === "install") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    printInstallHelp()
    process.exit(0)
  }
  await runOrExit(() => registerGatehouseGlobal(rest))
}

if (command === "upgrade") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    printUpgradeHelp()
    process.exit(0)
  }
  await runOrExit(() => upgradeGatehouseGlobal(rest))
}

if (command === "uninstall") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    printUninstallHelp()
    process.exit(0)
  }
  await runOrExit(() => uninstallGatehouseGlobal(rest))
}

if (command === "scaffold") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    printScaffoldHelp()
    process.exit(0)
  }
  await runOrExit(() => runGatehouseScaffold(rest))
}

if (command === "doctor") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`Usage:
  bunx @gatehouse/core doctor [-C project] [--probe] [--global-only]

Options:
  -C, --project <dir>   Gatehouse project root (default: cwd)
  --probe               Probe Portal / Admin ports (full scope only)
  --global-only         Check global layer only (skip Project / Portal / Models)

Exit codes:
  0  all passed
  1  errors
  2  warnings only

Examples:
  bunx @gatehouse/core doctor
  bunx @gatehouse/core doctor --global-only
  bunx @gatehouse/core doctor -C /path/to/project --probe
`)
    process.exit(0)
  }
  await runGatehouseDoctorCli(rest)
  process.exit(process.exitCode ?? 0)
}

if (command === "portal") {
  const port = process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  const adminPort = process.env.GATEHOUSE_PORTAL_ADMIN_PORT ?? String(DEFAULT_PORTAL_ADMIN_PORT)
  console.log(`Open http://127.0.0.1:${port}/ after OpenCode starts (plugin loads Portal automatically).`)
  console.log(`Portal admin: http://127.0.0.1:${adminPort}/admin`)
  process.exit(0)
}

console.log(`Invoke: bunx @gatehouse/core <subcommand>
       (or gatehouse <subcommand> after bun install -g @gatehouse/core)

Recommended one-time global setup:
  bunx @gatehouse/core install
  bunx @gatehouse/core doctor --global-only

Project setup (pick one):
  bunx @gatehouse/core scaffold -C /path/to/project
  cd /path/to/project && opencode

Other commands:
  bunx @gatehouse/core upgrade              # refresh plugin + agent definitions
  bunx @gatehouse/core uninstall            # remove from global OpenCode config
  bunx @gatehouse/core doctor [-C project] [--probe]
  bunx @gatehouse/core channels init|list|doctor|login|serve|stop|status
  bunx @gatehouse/core portal

Local .tgz from bun pm pack in packages/core:
  bunx @gatehouse/core install ./gatehouse-core-0.1.0.tgz --no-tui --locale=zh

npm: @gatehouse/core
`)
