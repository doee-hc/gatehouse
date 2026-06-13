import { readFileSync } from "node:fs"
import path from "node:path"
import { ensureGlobalGatehouseConfig } from "../gatehouse-config.ts"
import { GATEHOUSE_LOCALES, normalizeGatehouseLocale, type GatehouseLocale } from "../locale.ts"
import { gatehousePackageRoot } from "../setup/package.ts"
import {
  registerGatehouseArchiveInGlobalOpencodeConfig,
  registerGatehouseInGlobalOpencodeConfig,
} from "../setup/project.ts"
import { formatDoctorReport, runGatehouseDoctor } from "./doctor.ts"
import { checkInstallPrerequisites, formatPrerequisiteErrors } from "./prerequisites.ts"
import { hasFlag, optionValue, parseCliArgs } from "./parse-args.ts"

export type UpgradeOptions = {
  archivePath?: string
  locale?: GatehouseLocale
  skipDoctor?: boolean
  projectDir?: string
}

export async function upgradeGatehouseGlobal(rawArgs: string[] = []) {
  const args = parseCliArgs(rawArgs)
  const prerequisiteErrors = formatPrerequisiteErrors(await checkInstallPrerequisites())
  if (prerequisiteErrors.length > 0) {
    throw new Error(prerequisiteErrors.join("\n"))
  }

  const locale = normalizeGatehouseLocale(optionValue(args, "locale"))
  if (optionValue(args, "locale") && !locale) {
    throw new Error(`--locale must be ${GATEHOUSE_LOCALES.join(" or ")}`)
  }

  const options: UpgradeOptions = {
    archivePath: args.positional[0],
    locale,
    skipDoctor: hasFlag(args, "--skip-doctor", "skip-doctor"),
    projectDir: optionValue(args, "project"),
  }

  const packageRoot = gatehousePackageRoot()
  const pkgJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    version?: string
  }
  const version = pkgJson.version ?? "unknown"
  console.log(`[gatehouse] upgrading to @gatehouse/core@${version}`)

  if (options.locale) {
    const result = await ensureGlobalGatehouseConfig({ locale: options.locale })
    if (result.created) console.log(`[gatehouse] created global config: ${result.configPath}`)
    else if (result.updated) console.log(`[gatehouse] updated global config: ${result.configPath}`)
  }

  if (options.archivePath) {
    const hit = await registerGatehouseArchiveInGlobalOpencodeConfig(options.archivePath, {
      locale: options.locale,
    })
    console.log(`[gatehouse] registered plugin spec: ${hit.spec}`)
  } else {
    const configPath = await registerGatehouseInGlobalOpencodeConfig({ locale: options.locale })
    console.log(`[gatehouse] re-synced global OpenCode config: ${configPath}`)
  }

  console.log("✓ Upgrade complete — agent definitions and plugin registration refreshed")

  if (!options.skipDoctor) {
    console.log("")
    const report = await runGatehouseDoctor(options.projectDir ?? process.cwd(), false, "global")
    console.log(formatDoctorReport(report.issues))
  }
}

export function printUpgradeHelp() {
  console.log(`Usage:
  bunx @gatehouse/core upgrade [path/to/gatehouse-core-*.tgz]

Options:
  --locale=<zh|en>      Update global config.yaml locale
  --skip-doctor         Skip doctor after upgrade
  -C, --project <dir>   Unused for global upgrade (kept for CLI consistency)

Examples:
  bunx @gatehouse/core upgrade
  bunx @gatehouse/core upgrade --locale=zh
  bunx @gatehouse/core upgrade ./gatehouse-core-0.2.0.tgz
`)
}
