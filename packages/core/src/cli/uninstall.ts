import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { gatehouseGlobalConfigPath } from "../gatehouse-config.ts"
import {
  detectGlobalOpencodeConfigPath,
  globalOpencodeAgentDir,
  globalOpencodeConfigDir,
  MANAGED_GLOBAL_AGENT_FILES,
} from "../setup/global-opencode.ts"
import { parseJsoncConfig } from "../setup/jsonc.ts"
import { hasFlag, parseCliArgs } from "./parse-args.ts"

function isGatehousePluginSpec(spec: unknown) {
  if (typeof spec !== "string") return false
  return (
    spec.includes("gatehouse-plugin") ||
    spec.includes("gatehouse-core") ||
    spec.includes("gatehouse.core") ||
    spec.includes("gatehouse.tui") ||
    spec.includes("@gatehouse/core") ||
    (spec.startsWith("file:") && spec.includes("gatehouse"))
  )
}

function stripGatehousePlugins(plugins: unknown[]) {
  return plugins.filter((item) => {
    const spec = Array.isArray(item) ? item[0] : item
    return !isGatehousePluginSpec(spec)
  })
}

export async function uninstallGatehouseGlobal(rawArgs: string[] = []) {
  const args = parseCliArgs(rawArgs)
  const keepAgents = hasFlag(args, "--keep-agents", "keep-agents")
  const keepConfig = hasFlag(args, "--keep-config", "keep-config")
  const keepCache = hasFlag(args, "--keep-cache", "keep-cache")

  const configDir = globalOpencodeConfigDir()
  const configPath = detectGlobalOpencodeConfigPath()
  let removedPlugin = false

  if (existsSync(configPath)) {
    const config = parseJsoncConfig(readFileSync(configPath, "utf8"), configPath)
    const plugins = Array.isArray(config.plugin) ? config.plugin : []
    const next = stripGatehousePlugins(plugins)
    if (next.length !== plugins.length) {
      config.plugin = next
      await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`)
      removedPlugin = true
      console.log(`[gatehouse] removed plugin from ${configPath}`)
    }
  }

  const tuiPath = path.join(configDir, "tui.json")
  if (existsSync(tuiPath)) {
    const tuiConfig = parseJsoncConfig(readFileSync(tuiPath, "utf8"), tuiPath)
    const tuiPlugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
    const next = stripGatehousePlugins(tuiPlugins)
    if (next.length !== tuiPlugins.length) {
      tuiConfig.plugin = next
      await Bun.write(tuiPath, `${JSON.stringify(tuiConfig, null, 2)}\n`)
      removedPlugin = true
      console.log(`[gatehouse] removed plugin from ${tuiPath}`)
    }
  }

  if (!removedPlugin) {
    console.log("[gatehouse] no Gatehouse plugin entry found in global OpenCode config")
  }

  if (!keepAgents) {
    const agentDir = globalOpencodeAgentDir()
    for (const filename of MANAGED_GLOBAL_AGENT_FILES) {
      const agentPath = path.join(agentDir, filename)
      if (existsSync(agentPath)) {
        rmSync(agentPath, { force: true })
        console.log(`[gatehouse] removed ${agentPath}`)
      }
    }
  }

  if (!keepConfig && existsSync(gatehouseGlobalConfigPath())) {
    rmSync(gatehouseGlobalConfigPath(), { force: true })
    console.log(`[gatehouse] removed ${gatehouseGlobalConfigPath()}`)
  }

  if (!keepCache) {
    const cacheRoot = path.join(homedir(), ".cache", "gatehouse")
    if (existsSync(cacheRoot)) {
      rmSync(cacheRoot, { recursive: true, force: true })
      console.log(`[gatehouse] removed ${cacheRoot}`)
    }
  }

  console.log("")
  console.log("✓ Gatehouse uninstalled from global OpenCode config")
  console.log("  Project .gatehouse/ directories were not modified.")
}

export function printUninstallHelp() {
  console.log(`Usage:
  bunx @gatehouse/core uninstall

Options:
  --keep-agents   Keep ~/.config/opencode/agent/{lead,architect,curator,arbiter}.md
  --keep-config   Keep ~/.config/gatehouse/config.yaml
  --keep-cache    Keep ~/.cache/gatehouse/

Examples:
  bunx @gatehouse/core uninstall
  bunx @gatehouse/core uninstall --keep-config --keep-agents
`)
}
