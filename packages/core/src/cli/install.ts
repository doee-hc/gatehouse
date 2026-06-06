import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { ensureGlobalGatehouseConfig, parseGatehouseModel } from "../gatehouse-config.ts"
import { GATEHOUSE_LOCALES, normalizeGatehouseLocale, type GatehouseLocale } from "../locale.ts"
import { detectOpencodeCli } from "../setup/opencode-version.ts"
import {
  registerGatehouseArchiveInGlobalOpencodeConfig,
  registerGatehouseInGlobalOpencodeConfig,
} from "../setup/project.ts"
import { GATEHOUSE_NPM_PACKAGE } from "../setup/package.ts"
import { runGatehouseDoctor, formatDoctorReport } from "./doctor.ts"
import { hasFlag, optionValue, parseCliArgs, type ParsedCliArgs } from "./parse-args.ts"

export type InstallOptions = {
  archivePath?: string
  locale?: GatehouseLocale
  model?: string
  noTui?: boolean
  skipDoctor?: boolean
  projectDir?: string
}

async function promptLine(question: string, defaultValue?: string) {
  const rl = readline.createInterface({ input, output })
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : ""
    const answer = (await rl.question(`${question}${suffix}: `)).trim()
    return answer || defaultValue || ""
  } finally {
    rl.close()
  }
}

async function promptInstallOptions(args: ParsedCliArgs): Promise<InstallOptions> {
  if (hasFlag(args, "--no-tui", "no-tui")) {
    const locale = normalizeGatehouseLocale(optionValue(args, "locale"))
    const model = optionValue(args, "model")?.trim() || undefined
    if (optionValue(args, "locale") && !locale) {
      throw new Error(`--locale 必须是 ${GATEHOUSE_LOCALES.join(" 或 ")}`)
    }
    return {
      archivePath: args.positional[0],
      locale,
      model,
      noTui: true,
      skipDoctor: hasFlag(args, "--skip-doctor", "skip-doctor"),
      projectDir: optionValue(args, "project"),
    }
  }

  console.log("Gatehouse 安装向导")
  console.log("")

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    console.log("! 未检测到 OpenCode CLI — 请先安装 https://opencode.ai ，安装完成后可重新运行 install。")
  } else if (opencode.version) {
    console.log(`✓ 检测到 OpenCode ${opencode.version}`)
  }

  const localeAnswer = await promptLine(`界面语言 (${GATEHOUSE_LOCALES.join("/")})`, "zh")
  const locale = normalizeGatehouseLocale(localeAnswer)
  if (!locale) {
    throw new Error(`无效 locale: ${localeAnswer}`)
  }

  const modelAnswer = await promptLine("默认模型 (provider/model-id，留空跳过)", "")
  const model = modelAnswer.trim() || undefined
  if (model) {
    parseGatehouseModel(model)
  }

  return {
    archivePath: args.positional[0],
    locale,
    model,
    skipDoctor: hasFlag(args, "--skip-doctor", "skip-doctor"),
    projectDir: optionValue(args, "project"),
  }
}

function printInstallSuccess(configPath: string) {
  console.log("")
  console.log("✓ Gatehouse 全局注册完成")
  console.log(`  OpenCode 配置: ${configPath}`)
  console.log(`  Gatehouse 配置: ~/.config/gatehouse/config.yaml`)
  console.log("")
  console.log("下一步:")
  console.log("  1. cd 到你的项目目录")
  console.log("  2. 运行 opencode（首次启动会自动创建 .gatehouse/）")
  console.log(`  3. 浏览器打开 http://127.0.0.1:${DEFAULT_PORTAL_DISPLAY_PORT}/ 查看 Portal`)
  console.log("  4. 验证: bunx @gatehouse/core doctor")
  console.log("  5. （可选）IM 通道: bunx @gatehouse/core channels init")
  console.log("")
  console.log("认证: 若尚未配置模型 provider，请在 OpenCode 中运行 opencode auth login")
}

/** Register Gatehouse globally — same outcome as `opencode plug @gatehouse/core --global`. */
export async function registerGatehouseGlobal(rawArgs: string[] = []) {
  const args = parseCliArgs(rawArgs)
  const options = await promptInstallOptions(args)

  if (options.locale || options.model) {
    const result = await ensureGlobalGatehouseConfig({
      locale: options.locale,
      model: options.model,
    })
    if (result.created) {
      console.log(`[gatehouse] created global config: ${result.configPath}`)
    } else if (result.updated) {
      console.log(`[gatehouse] updated global config: ${result.configPath}`)
    }
  }

  if (options.archivePath) {
    const hit = await registerGatehouseArchiveInGlobalOpencodeConfig(options.archivePath, {
      locale: options.locale,
    })
    console.log(`[gatehouse] registered plugin spec: ${hit.spec}`)
    printInstallSuccess(hit.configPath)
  } else {
    const configPath = await registerGatehouseInGlobalOpencodeConfig({ locale: options.locale })
    console.log(`[gatehouse] registered ${GATEHOUSE_NPM_PACKAGE} in global OpenCode config`)
    printInstallSuccess(configPath)
  }

  if (!options.skipDoctor) {
    console.log("")
    const report = await runGatehouseDoctor(options.projectDir ?? process.cwd(), false)
    console.log(formatDoctorReport(report.issues))
    if (report.exitCode !== 0) {
      console.log("\n安装已完成，但 doctor 报告存在问题 — 请按上方提示修复。")
    }
  }
}

export function printInstallHelp() {
  console.log(`Usage:
  bunx @gatehouse/core install [path/to/gatehouse-core-*.tgz]

Options:
  --no-tui              非交互安装（CI / LLM Agent）
  --locale=<zh|en>      全局 config.yaml 语言（配合 --no-tui）
  --model=<provider/id> 为全部角色写入默认模型（配合 --no-tui）
  --skip-doctor         安装完成后跳过 doctor
  -C, --project <dir>   doctor 检查的项目目录（默认当前目录）

Examples:
  bunx @gatehouse/core install
  bunx @gatehouse/core install --no-tui --locale=zh --model=opencode/big-pickle
  bunx @gatehouse/core install ./gatehouse-core-0.1.0.tgz --no-tui
`)
}
