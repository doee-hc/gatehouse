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

export type DoctorReport = {
  issues: DoctorIssue[]
  exitCode: 0 | 1 | 2
}

export async function runGatehouseDoctor(projectDir: string, probe = false): Promise<DoctorReport> {
  const issues: DoctorIssue[] = []
  const root = path.resolve(projectDir)

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    issues.push({
      level: "error",
      category: "System",
      message: "未找到 OpenCode CLI，请先安装 https://opencode.ai",
    })
  } else if (!opencode.version) {
    issues.push({
      level: "warn",
      category: "System",
      message: `OpenCode 已安装，但无法解析版本${opencode.raw ? ` (${opencode.raw})` : ""}`,
    })
  } else {
    const check = satisfiesOpencodeVersion(opencode.version)
    if (check.ok) {
      issues.push({
        level: "ok",
        category: "System",
        message: `OpenCode ${opencode.version} 已安装`,
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
      message: version ? `Bun ${version} 可用` : "Bun 可用",
    })
  } else {
    issues.push({
      level: "warn",
      category: "System",
      message: "未找到 Bun — Gatehouse 插件运行时通常需要 Bun",
    })
  }

  const { configPath, config } = readGlobalOpencodeConfig()
  const serverSpecs = extractOpencodePluginSpecs(config)
  if (serverSpecs.some(isGatehouseServerPluginSpec)) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `全局 server 插件已注册 (${configPath})`,
    })
  } else {
    issues.push({
      level: "error",
      category: "Config",
      message: `全局 OpenCode 配置缺少 @gatehouse/core — 运行: bunx @gatehouse/core install`,
    })
  }

  const { tuiPath, config: tuiConfig } = readGlobalOpencodeTuiConfig()
  const tuiSpecs = extractOpencodePluginSpecs(tuiConfig)
  if (tuiSpecs.some(isGatehouseTuiPluginSpec)) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `全局 TUI 插件已注册 (${tuiPath})`,
    })
  } else {
    issues.push({
      level: "error",
      category: "Config",
      message: `~/.config/opencode/tui.json 缺少 @gatehouse/core/tui — 运行: bunx @gatehouse/core install`,
    })
  }

  if (existsSync(gatehouseGlobalConfigPath())) {
    issues.push({
      level: "ok",
      category: "Config",
      message: `全局 Gatehouse 配置已存在 (${gatehouseGlobalConfigPath()})`,
    })
  } else {
    issues.push({
      level: "warn",
      category: "Config",
      message: "缺少 ~/.config/gatehouse/config.yaml — install 时会自动创建",
    })
  }

  for (const filename of MANAGED_GLOBAL_AGENT_FILES) {
    const agentPath = globalOpencodeAgentPath(filename)
    if (existsSync(agentPath)) {
      issues.push({
        level: "ok",
        category: "Agents",
        message: `${filename} 已同步`,
      })
    } else {
      issues.push({
        level: "error",
        category: "Agents",
        message: `缺少 ${agentPath} — 运行: bunx @gatehouse/core install`,
      })
    }
  }

  if (!existsSync(root)) {
    issues.push({
      level: "error",
      category: "Project",
      message: `项目目录不存在: ${root}`,
    })
  } else if (!existsSync(gatehouseRoot(root))) {
    issues.push({
      level: "warn",
      category: "Project",
      message: "缺少 .gatehouse/ — 在项目目录启动 OpenCode 后会自动 scaffold",
    })
  } else {
    issues.push({
      level: "ok",
      category: "Project",
      message: `.gatehouse/ 已存在 (${gatehouseRoot(root)})`,
    })

    const projectConfigPath = projectOpencodeConfigPath(root)
    if (existsSync(projectConfigPath)) {
      const projectConfig = await readProjectOpencodeConfig(root)
      const defaultAgent = projectConfig.default_agent
      const skillPaths = (projectConfig.skills as { paths?: string[] } | undefined)?.paths ?? []
      if (defaultAgent === "lead") {
        issues.push({ level: "ok", category: "Project", message: "项目 default_agent=lead" })
      } else {
        issues.push({
          level: "warn",
          category: "Project",
          message: `项目 default_agent=${String(defaultAgent)}（期望 lead）`,
        })
      }
      if (skillPaths.includes(".gatehouse")) {
        issues.push({ level: "ok", category: "Project", message: "skills.paths 包含 .gatehouse" })
      } else {
        issues.push({
          level: "warn",
          category: "Project",
          message: "项目 opencode.jsonc 未包含 skills.paths: [\".gatehouse\"]",
        })
      }
    } else {
      issues.push({
        level: "warn",
        category: "Project",
        message: "缺少项目 opencode.jsonc — 首次启动 OpenCode 时会自动创建",
      })
    }
  }

  if (probe) {
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
  } else {
    issues.push({
      level: "warn",
      category: "Portal",
      message: "Portal probe skipped — pass --probe to check",
    })
  }

  if (existsSync(gatehouseRoot(root))) {
    const config = loadGatehouseConfig(root)
    const configuredModels = Object.entries(config.models).filter(([, value]) => Boolean(value))
    if (configuredModels.length === 0) {
      issues.push({
        level: "warn",
        category: "Models",
        message: "未配置 models — 将使用 OpenCode 默认模型；可在 config.yaml 或 install --model 设置",
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
  } else {
    issues.push({
      level: "warn",
      category: "Models",
      message: "项目尚未 scaffold，跳过 models 检查",
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
  const report = await runGatehouseDoctor(projectDir, probe)
  console.log(formatDoctorReport(report.issues))
  if (report.exitCode === 2) {
    console.log("\nDoctor 完成，存在警告。")
  } else if (report.exitCode === 1) {
    console.log("\nDoctor 发现错误，请先修复后再启动 OpenCode。")
  } else {
    console.log("\nDoctor 全部通过。")
  }
  process.exitCode = report.exitCode
}
