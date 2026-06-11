import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { ensureGlobalGatehouseConfig } from "../gatehouse-config.ts"
import { GATEHOUSE_LOCALES, normalizeGatehouseLocale, type GatehouseLocale } from "../locale.ts"
import { detectOpencodeCli } from "../setup/opencode-version.ts"
import {
  registerGatehouseArchiveInGlobalOpencodeConfig,
  registerGatehouseInGlobalOpencodeConfig,
} from "../setup/project.ts"
import { GATEHOUSE_NPM_PACKAGE } from "../setup/package.ts"
import { runGatehouseDoctor, formatDoctorReport } from "./doctor.ts"
import { defaultWizardLocale, detectWizardLang, wizardStrings } from "./i18n.ts"
import { checkInstallPrerequisites, formatPrerequisiteErrors } from "./prerequisites.ts"
import { hasFlag, optionValue, parseCliArgs, type ParsedCliArgs } from "./parse-args.ts"

export type InstallOptions = {
  archivePath?: string
  locale?: GatehouseLocale
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
  const wizardLang = detectWizardLang()
  const strings = wizardStrings(wizardLang)

  if (hasFlag(args, "--no-tui", "no-tui")) {
    const locale = normalizeGatehouseLocale(optionValue(args, "locale"))
    if (optionValue(args, "locale") && !locale) {
      throw new Error(`--locale must be ${GATEHOUSE_LOCALES.join(" or ")}`)
    }
    return {
      archivePath: args.positional[0],
      locale,
      noTui: true,
      skipDoctor: hasFlag(args, "--skip-doctor", "skip-doctor"),
      projectDir: optionValue(args, "project"),
    }
  }

  console.log(strings.title)
  console.log("")

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    console.log(strings.opencodeMissing)
  } else if (opencode.version) {
    console.log(strings.opencodeOk(opencode.version))
  }

  const defaultLocale = defaultWizardLocale(wizardLang)
  const localeAnswer = await promptLine(strings.localePrompt(GATEHOUSE_LOCALES.join("/")), defaultLocale)
  const locale = normalizeGatehouseLocale(localeAnswer)
  if (!locale) {
    throw new Error(strings.invalidLocale(localeAnswer))
  }

  return {
    archivePath: args.positional[0],
    locale,
    skipDoctor: hasFlag(args, "--skip-doctor", "skip-doctor"),
    projectDir: optionValue(args, "project"),
  }
}

function printInstallSuccess(configPath: string, wizardLang = detectWizardLang()) {
  const strings = wizardStrings(wizardLang)
  const port = DEFAULT_PORTAL_DISPLAY_PORT
  console.log("")
  console.log(strings.globalDone)
  console.log(strings.configPath(configPath))
  console.log(strings.gatehouseConfigPath)
  console.log("")
  console.log(strings.nextTitle)
  console.log(strings.nextScaffold)
  console.log(strings.nextOpencode)
  console.log(strings.nextPortal(port))
  console.log(strings.nextDoctor)
  console.log(strings.nextChannelsHint)
}

/** Register Gatehouse globally — same outcome as `opencode plug @gatehouse/core --global` plus config sync. */
export async function registerGatehouseGlobal(rawArgs: string[] = []) {
  const args = parseCliArgs(rawArgs)
  const prerequisiteErrors = formatPrerequisiteErrors(await checkInstallPrerequisites())
  if (prerequisiteErrors.length > 0) {
    throw new Error(prerequisiteErrors.join("\n"))
  }

  const options = await promptInstallOptions(args)
  const wizardLang = detectWizardLang()

  if (options.locale) {
    const result = await ensureGlobalGatehouseConfig({ locale: options.locale })
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
    printInstallSuccess(hit.configPath, wizardLang)
  } else {
    const configPath = await registerGatehouseInGlobalOpencodeConfig({ locale: options.locale })
    console.log(`[gatehouse] registered ${GATEHOUSE_NPM_PACKAGE} in global OpenCode config`)
    printInstallSuccess(configPath, wizardLang)
  }

  if (!options.skipDoctor) {
    console.log("")
    console.log(wizardStrings(wizardLang).installDoctorNote)
    console.log("")
    const report = await runGatehouseDoctor(options.projectDir ?? process.cwd(), false, "global")
    console.log(formatDoctorReport(report.issues))
    if (report.exitCode !== 0) {
      console.log(
        wizardLang === "zh"
          ? "\n全局安装已完成，但 doctor 报告存在问题 — 请按上方提示修复。"
          : "\nGlobal install finished, but doctor reported issues — fix them before starting OpenCode.",
      )
    }
  }
}

export function printInstallHelp() {
  console.log(`Usage:
  bunx @gatehouse/core install [path/to/gatehouse-core-*.tgz]

Options:
  --no-tui              Non-interactive install (CI / LLM agents)
  --locale=<zh|en>      Global config.yaml locale (with --no-tui)
  --skip-doctor         Skip doctor after install
  -C, --project <dir>   Project dir for doctor (default: cwd; global-only scope)

Examples:
  bunx @gatehouse/core install
  bunx @gatehouse/core install --no-tui --locale=zh
  bunx @gatehouse/core install ./gatehouse-core-0.1.0.tgz --no-tui

Note: Model presets are not configured during install — edit ~/.config/gatehouse/config.yaml if needed.
`)
}
