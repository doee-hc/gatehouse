import { existsSync } from "node:fs"
import path from "node:path"
import {
  gatehouseGlobalConfigPath,
  loadGatehouseConfig,
  parseGatehouseModel,
} from "../gatehouse-config.ts"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { discoverPortalEndpoints } from "../portal/ports.ts"
import {
  extractOpencodePluginSpecs,
  globalOpencodeAgentPath,
  isGatehouseServerPluginSpec,
  isGatehouseTuiPluginSpec,
  MANAGED_GLOBAL_AGENT_FILES,
  projectOpencodeConfigPath,
  readGlobalOpencodeConfig,
  readGlobalOpencodeTuiConfig,
  readProjectOpencodeConfig,
} from "../setup/global-opencode.ts"
import { detectOpencodeCli, satisfiesOpencodeVersion } from "../setup/opencode-version.ts"
import { gatehouseRoot } from "../paths.ts"

export type DoctorIssue = {
  level: "error" | "warn" | "ok"
  category: "System" | "Config" | "Agents" | "Project" | "Portal" | "Models"
  message: string
}

export type DoctorScope = "full" | "global"

export type DoctorReport = {
  issues: DoctorIssue[]
  exitCode: 0 | 1 | 2
}

export async function runGatehouseDoctor(
  projectDir: string,
  probe = false,
  scope: DoctorScope = "full",
): Promise<DoctorReport> {
  const issues: DoctorIssue[] = []
  const root = path.resolve(projectDir)

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    issues.push({
      level: "error",
      category: "System",
      message: "OpenCode CLI not found — install from https://opencode.ai",
    })
  } else if (!opencode.version) {
    issues.push({
      level: "warn",
      category: "System",
      message: `OpenCode is installed but version could not be parsed${opencode.raw ? ` (${opencode.raw})` : ""}`,
    })
  } else {
    const check = satisfiesOpencodeVersion(opencode.version)
    if (check.ok) {
      issues.push({
        level: "ok",
        category: "System",
        message: `OpenCode ${opencode.version} installed`,
      })
    } else {
      issues.push({ level: "error", category: "System", message: check.reason })
    }
  }

  const bunWhich = Bun.spawnSync(["which", "bun"], { stdout: "pipe", stderr: "ignore" })
  if (bunWhich.exitCode === 0) {
    const bunVersion = Bun.spawnSync(["bun", "--version"], { stdout: "pipe", stderr: "ignore" })
    const version = bunVersion.stdout ? Buffer.from(bunVersion.stdout).toString("utf8").trim() : ""
    issues.push({
      level: "ok",
      category: "System",
      message: version ? `Bun ${version} available` : "Bun available",
    })
  } else {
    issues.push({
      level: "warn",
      category: "System",
      message: "Bun not found — Gatehouse plugin runtime usually requires Bun",
    })
  }

  const { configPath, config } = readGlobalOpencodeConfig()
  const serverSpecs = extractOpencodePluginSpecs(config)
  if (serverSpecs.some(isGatehouseServerPluginSpec)) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `Global server plugin registered (${configPath})`,
    })
  } else {
    issues.push({
      level: "error",
      category: "Config",
      message: `Global OpenCode config missing @gatehouse/core — run: bunx @gatehouse/core install`,
    })
  }

  const { tuiPath, config: tuiConfig } = readGlobalOpencodeTuiConfig()
  const tuiSpecs = extractOpencodePluginSpecs(tuiConfig)
  if (tuiSpecs.some(isGatehouseTuiPluginSpec)) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `Global TUI plugin registered (${tuiPath})`,
    })
  } else {
    issues.push({
      level: "error",
      category: "Config",
      message: `~/.config/opencode/tui.json missing @gatehouse/core — run: bunx @gatehouse/core install`,
    })
  }

  if (existsSync(gatehouseGlobalConfigPath())) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `Global Gatehouse config exists (${gatehouseGlobalConfigPath()})`,
    })
  } else {
    issues.push({
      level: "warn",
      category: "Config",
      message: "Missing ~/.config/gatehouse/config.yaml — created automatically during install",
    })
  }

  for (const filename of MANAGED_GLOBAL_AGENT_FILES) {
    const agentPath = globalOpencodeAgentPath(filename)
    if (existsSync(agentPath)) {
      issues.push({
        level: "ok",
        category: "Agents",
        message: `${filename} synced`,
      })
    } else {
      issues.push({
        level: "error",
        category: "Agents",
        message: `Missing ${agentPath} — run: bunx @gatehouse/core install`,
      })
    }
  }

  if (scope === "full") {
    if (!existsSync(root)) {
      issues.push({
        level: "error",
        category: "Project",
        message: `Project directory does not exist: ${root}`,
      })
    } else if (!existsSync(gatehouseRoot(root))) {
      issues.push({
        level: "warn",
        category: "Project",
        message:
          "Missing .gatehouse/ — run bunx @gatehouse/core scaffold -C <project> or start opencode in the project directory",
      })
    } else {
      issues.push({
        level: "ok",
        category: "Project",
        message: `.gatehouse/ exists (${gatehouseRoot(root)})`,
      })

      const projectConfigPath = projectOpencodeConfigPath(root)
      if (existsSync(projectConfigPath)) {
        const projectConfig = await readProjectOpencodeConfig(root)
        const defaultAgent = projectConfig.default_agent
        const skillPaths = (projectConfig.skills as { paths?: string[] } | undefined)?.paths ?? []
        if (defaultAgent === "lead") {
          issues.push({ level: "ok", category: "Project", message: "Project default_agent=lead" })
        } else {
          issues.push({
            level: "warn",
            category: "Project",
            message: `Project default_agent=${String(defaultAgent)} (expected lead)`,
          })
        }
        if (skillPaths.includes(".gatehouse")) {
          issues.push({ level: "ok", category: "Project", message: "skills.paths includes .gatehouse" })
        } else {
          issues.push({
            level: "warn",
            category: "Project",
            message: "Project opencode.jsonc missing skills.paths: [\".gatehouse\"]",
          })
        }
      } else {
        issues.push({
          level: "warn",
          category: "Project",
          message: "Missing project opencode.jsonc — created by scaffold or on first OpenCode start",
        })
      }
    }
  }

  if (scope === "full" && probe) {
    try {
      const endpoints = await discoverPortalEndpoints(root)
      if (endpoints.displayReachable) {
        issues.push({
          level: "ok",
          category: "Portal",
          message: `Portal reachable at http://127.0.0.1:${endpoints.displayPort}/`,
        })
      } else {
        issues.push({
          level: "warn",
          category: "Portal",
          message: `Portal not running — start OpenCode, then open http://127.0.0.1:${DEFAULT_PORTAL_DISPLAY_PORT}/`,
        })
      }
      if (endpoints.adminReachable && endpoints.adminPort) {
        issues.push({
          level: "ok",
          category: "Portal",
          message: `Portal Admin reachable at http://127.0.0.1:${endpoints.adminPort}/admin`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      issues.push({ level: "warn", category: "Portal", message: `Portal probe failed: ${message}` })
    }
  } else if (scope === "full") {
    issues.push({
      level: "warn",
      category: "Portal",
      message: "Portal probe skipped — pass --probe to check",
    })
  }

  if (scope === "full" && existsSync(gatehouseRoot(root))) {
    const config = loadGatehouseConfig(root)
    const configuredModels = Object.entries(config.models).filter(([, value]) => Boolean(value))
    if (configuredModels.length === 0) {
      issues.push({
        level: "warn",
        category: "Models",
        message: "No models configured — OpenCode defaults will be used; set in config.yaml",
      })
    } else {
      for (const [profile, model] of configuredModels) {
        try {
          parseGatehouseModel(model!)
          issues.push({
            level: "ok",
            category: "Models",
            message: `${profile}: ${model}`,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          issues.push({ level: "error", category: "Models", message: `${profile}: ${message}` })
        }
      }
    }
  } else if (scope === "full") {
    issues.push({
      level: "warn",
      category: "Models",
      message: "Project not scaffolded yet — skipping models check",
    })
  }

  const hasError = issues.some((issue) => issue.level === "error")
  const hasWarn = issues.some((issue) => issue.level === "warn")
  const exitCode = hasError ? 1 : hasWarn ? 2 : 0
  return { issues, exitCode }
}

export function formatDoctorReport(issues: DoctorIssue[]) {
  const categories = ["System", "Config", "Agents", "Project", "Portal", "Models"] as const
  const lines: string[] = ["Gatehouse Doctor", ""]

  for (const category of categories) {
    const group = issues.filter((issue) => issue.category === category)
    if (group.length === 0) continue
    lines.push(`[${category}]`)
    for (const issue of group) {
      const tag = issue.level === "error" ? "✗" : issue.level === "warn" ? "!" : "✓"
      lines.push(`${tag} ${issue.message}`)
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

export async function runGatehouseDoctorCli(args: string[]) {
  const { parseCliArgs, hasFlag, optionValue } = await import("./parse-args.ts")
  const parsed = parseCliArgs(args)
  const projectDir = optionValue(parsed, "project") ?? process.cwd()
  const probe = hasFlag(parsed, "--probe", "-probe", "probe")
  const globalOnly = hasFlag(parsed, "--global-only", "global-only")
  const report = await runGatehouseDoctor(projectDir, probe, globalOnly ? "global" : "full")
  console.log(formatDoctorReport(report.issues))
  if (report.exitCode === 2) {
    console.log("\nDoctor finished with warnings.")
  } else if (report.exitCode === 1) {
    console.log("\nDoctor found errors — fix them before starting OpenCode.")
  } else {
    console.log("\nDoctor passed.")
  }
  process.exitCode = report.exitCode
}
