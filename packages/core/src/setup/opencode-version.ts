export const MIN_OPENCODE_VERSION = "1.14.40"
export const MAX_OPENCODE_VERSION_EXCLUSIVE = "1.17.0"

export type ParsedSemver = {
  major: number
  minor: number
  patch: number
}

export function parseSemver(input: string): ParsedSemver | undefined {
  const match = input.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareSemver(left: string, right: string) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return 0
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] < b[key]) return -1
    if (a[key] > b[key]) return 1
  }
  return 0
}

export function satisfiesOpencodeVersion(version: string) {
  const parsed = parseSemver(version)
  if (!parsed) {
    return { ok: false as const, reason: `无法解析 OpenCode 版本: ${version}` }
  }
  if (compareSemver(version, MIN_OPENCODE_VERSION) < 0) {
    return {
      ok: false as const,
      reason: `OpenCode ${version} 过低，需要 >= ${MIN_OPENCODE_VERSION}`,
    }
  }
  if (compareSemver(version, MAX_OPENCODE_VERSION_EXCLUSIVE) >= 0) {
    return {
      ok: false as const,
      reason: `OpenCode ${version} 尚未验证，Gatehouse 当前支持 < ${MAX_OPENCODE_VERSION_EXCLUSIVE}`,
    }
  }
  return { ok: true as const, version }
}

export type OpencodeDetection = {
  installed: boolean
  version?: string
  raw?: string
}

export async function detectOpencodeCli(): Promise<OpencodeDetection> {
  const bin = process.env.OPENCODE_BIN?.trim() || "opencode"
  const which = Bun.spawnSync(["which", bin], { stdout: "pipe", stderr: "ignore" })
  if (which.exitCode !== 0) return { installed: false }

  const proc = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "pipe" })
  const raw = [proc.stdout, proc.stderr]
    .map((buffer) => (buffer ? Buffer.from(buffer).toString("utf8").trim() : ""))
    .filter(Boolean)
    .join("\n")
  const version = parseSemver(raw)?.major !== undefined ? raw.match(/(\d+\.\d+\.\d+)/)?.[1] : undefined
  return { installed: true, version, raw: raw || undefined }
}
