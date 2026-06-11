import type { GatehouseLocale } from "../locale.ts"

export type WizardLang = "zh" | "en"

export function detectWizardLang(): WizardLang {
  const lang = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase()
  return lang.startsWith("zh") ? "zh" : "en"
}

type WizardStrings = {
  title: string
  opencodeMissing: string
  opencodeOk: (version: string) => string
  localePrompt: (locales: string) => string
  invalidLocale: (value: string) => string
  globalDone: string
  configPath: (path: string) => string
  gatehouseConfigPath: string
  nextTitle: string
  nextScaffold: string
  nextOpencode: string
  nextPortal: (port: number) => string
  nextDoctor: string
  nextChannelsHint: string
  installDoctorNote: string
}

const STRINGS: Record<WizardLang, WizardStrings> = {
  zh: {
    title: "Gatehouse 安装向导",
    opencodeMissing: "! 未检测到 OpenCode CLI — 请先安装 https://opencode.ai",
    opencodeOk: (version) => `✓ 检测到 OpenCode ${version}`,
    localePrompt: (locales) => `界面语言 (${locales})`,
    invalidLocale: (value) => `无效 locale: ${value}`,
    globalDone: "✓ 全局安装完成",
    configPath: (p) => `  OpenCode 配置: ${p}`,
    gatehouseConfigPath: "  Gatehouse 配置: ~/.config/gatehouse/config.yaml",
    nextTitle: "项目初始化（二选一）:",
    nextScaffold: "  A. bunx @gatehouse/core scaffold -C <项目目录>  # 提前创建 .gatehouse/",
    nextOpencode: "  B. cd <项目目录> && opencode                     # 首次启动时自动创建",
    nextPortal: (port) => `  启动后打开 Portal: http://127.0.0.1:${port}/`,
    nextDoctor: "  验证: bunx @gatehouse/core doctor -C <项目目录>",
    nextChannelsHint: "  （可选）IM 通道: bunx @gatehouse/core channels init",
    installDoctorNote: "以下为全局层检查结果；项目层请在 scaffold 或首次 opencode 后再运行 doctor。",
  },
  en: {
    title: "Gatehouse Install Wizard",
    opencodeMissing: "! OpenCode CLI not found — install from https://opencode.ai first",
    opencodeOk: (version) => `✓ OpenCode ${version} detected`,
    localePrompt: (locales) => `UI locale (${locales})`,
    invalidLocale: (value) => `Invalid locale: ${value}`,
    globalDone: "✓ Global install complete",
    configPath: (p) => `  OpenCode config: ${p}`,
    gatehouseConfigPath: "  Gatehouse config: ~/.config/gatehouse/config.yaml",
    nextTitle: "Project setup (pick one):",
    nextScaffold: "  A. bunx @gatehouse/core scaffold -C <project>   # create .gatehouse/ now",
    nextOpencode: "  B. cd <project> && opencode                        # auto-create on first start",
    nextPortal: (port) => `  Then open Portal: http://127.0.0.1:${port}/`,
    nextDoctor: "  Verify: bunx @gatehouse/core doctor -C <project>",
    nextChannelsHint: "  (Optional) IM channels: bunx @gatehouse/core channels init",
    installDoctorNote:
      "Global-layer checks below. For project checks, run doctor after scaffold or first opencode.",
  },
}

export function wizardStrings(lang: WizardLang = detectWizardLang()) {
  return STRINGS[lang]
}

export function defaultWizardLocale(lang: WizardLang): GatehouseLocale {
  return lang === "zh" ? "zh" : "en"
}
