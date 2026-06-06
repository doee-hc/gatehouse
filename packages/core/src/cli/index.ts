#!/usr/bin/env bun
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { registerGatehouseGlobal, printInstallHelp } from "./install.ts"
import { runGatehouseDoctorCli } from "./doctor.ts"
import { runChannelsCommand } from "./channels.ts"
import { parseCliArgs } from "./parse-args.ts"

const args = process.argv.slice(2)
const command = args[0] ?? "help"

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
  try {
    await registerGatehouseGlobal(rest)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[gatehouse] install failed: ${message}`)
    process.exit(1)
  }
  process.exit(0)
}

if (command === "doctor") {
  const rest = args.slice(1)
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`Usage:
  bunx @gatehouse/core doctor [-C project] [--probe]

Options:
  -C, --project <dir>   Gatehouse 项目根目录（默认当前目录）
  --probe               探测 Portal / Admin 端口是否可达

Exit codes:
  0  全部通过
  1  存在 error
  2  仅 warning

Examples:
  bunx @gatehouse/core doctor
  bunx @gatehouse/core doctor --probe
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

Usage:
  bunx @gatehouse/core install [path/to/gatehouse-core-*.tgz]
                             # register plugin in ~/.config/opencode

  bunx @gatehouse/core doctor [-C project] [--probe]
                             # health check (System / Config / Agents / Project / Portal / Models)

  bunx @gatehouse/core channels init|list|doctor|login|serve|stop|status
                             # IM bridge supervisor (微信 / 飞书 / QQ)

Local .tgz from bun pm pack in packages/core (filename: gatehouse-core-*.tgz):
  tar -xzf gatehouse-core-0.1.0.tgz && bun ./package/bin/gatehouse.ts install ./gatehouse-core-0.1.0.tgz
  # or after extract + bun install --production in that directory:
  opencode plug /absolute/path/to/extracted/package --global --force

Recommended (global install — no project path):
  opencode plug @gatehouse/core --global
  bunx @gatehouse/core install
  bunx @gatehouse/core doctor

Then start OpenCode in your project — Gatehouse scaffolds .gatehouse/ automatically.

  bunx @gatehouse/core portal

npm: @gatehouse/core
`)
