import { detectOpencodeCli, satisfiesOpencodeVersion } from "../setup/opencode-version.ts"

export type PrerequisiteIssue = {
  level: "error" | "warn"
  message: string
}

export async function checkInstallPrerequisites(): Promise<PrerequisiteIssue[]> {
  const issues: PrerequisiteIssue[] = []

  const bunWhich = Bun.spawnSync(["which", "bun"], { stdout: "pipe", stderr: "ignore" })
  if (bunWhich.exitCode !== 0) {
    issues.push({
      level: "error",
      message: "未找到 Bun — 请先安装 https://bun.sh （Gatehouse CLI 依赖 Bun）",
    })
  }

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    issues.push({
      level: "error",
      message: "未找到 OpenCode CLI — 请先安装 https://opencode.ai",
    })
    return issues
  }

  if (!opencode.version) {
    issues.push({
      level: "error",
      message: `无法解析 OpenCode 版本${opencode.raw ? ` (${opencode.raw})` : ""}`,
    })
    return issues
  }

  const versionCheck = satisfiesOpencodeVersion(opencode.version)
  if (!versionCheck.ok) {
    issues.push({ level: "error", message: versionCheck.reason })
  }

  return issues
}

export function formatPrerequisiteErrors(issues: PrerequisiteIssue[]) {
  return issues.filter((issue) => issue.level === "error").map((issue) => issue.message)
}
