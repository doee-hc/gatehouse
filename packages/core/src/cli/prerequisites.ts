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
      message: "Bun not found — install from https://bun.sh (Gatehouse CLI requires Bun)",
    })
  }

  const opencode = await detectOpencodeCli()
  if (!opencode.installed) {
    issues.push({
      level: "error",
      message: "OpenCode CLI not found — install from https://opencode.ai",
    })
    return issues
  }

  if (!opencode.version) {
    issues.push({
      level: "error",
      message: `Could not parse OpenCode version${opencode.raw ? ` (${opencode.raw})` : ""}`,
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
