import { unlink } from "node:fs/promises"
import path from "node:path"

/** Project OpenCode config — always project root `opencode.jsonc`. */
export function projectOpencodeConfigPath(projectRoot: string) {
  return path.join(path.resolve(projectRoot), "opencode.jsonc")
}

export function legacyProjectOpencodeJsoncPath(projectRoot: string) {
  return path.join(path.resolve(projectRoot), ".opencode", "opencode.jsonc")
}

/** @deprecated Use `legacyProjectOpencodeJsoncPath`. */
export const legacyProjectOpencodeConfigPath = legacyProjectOpencodeJsoncPath

export function legacyProjectOpencodeJsonPath(projectRoot: string) {
  return path.join(path.resolve(projectRoot), "opencode.json")
}

export type ProjectOpencodeConfigSources = {
  configPath: string
  sourcePath: string | null
  legacySources: string[]
}

export async function resolveProjectOpencodeConfigSources(
  projectRoot: string,
): Promise<ProjectOpencodeConfigSources> {
  const root = path.resolve(projectRoot)
  const configPath = projectOpencodeConfigPath(root)
  if (await Bun.file(configPath).exists()) {
    return { configPath, sourcePath: configPath, legacySources: [] }
  }

  const legacySources: string[] = []
  const legacyJsonc = legacyProjectOpencodeJsoncPath(root)
  if (await Bun.file(legacyJsonc).exists()) legacySources.push(legacyJsonc)
  const legacyJson = legacyProjectOpencodeJsonPath(root)
  if (await Bun.file(legacyJson).exists()) legacySources.push(legacyJson)

  return {
    configPath,
    sourcePath: legacySources[0] ?? null,
    legacySources,
  }
}

export async function removeLegacyOpencodeConfigSources(paths: string[]) {
  for (const file of paths) {
    await unlink(file).catch(() => undefined)
  }
}

/** Copy the first legacy project config to root `opencode.jsonc` and remove legacy files. */
export async function migrateLegacyProjectOpencodeConfig(projectRoot: string) {
  const { configPath, sourcePath, legacySources } = await resolveProjectOpencodeConfigSources(projectRoot)
  if (!sourcePath || sourcePath === configPath) return

  await Bun.write(configPath, await Bun.file(sourcePath).text())
  await removeLegacyOpencodeConfigSources(legacySources)
}

export async function readProjectOpencodeConfigText(projectRoot: string) {
  const { sourcePath } = await resolveProjectOpencodeConfigSources(projectRoot)
  if (!sourcePath) return null
  return { text: await Bun.file(sourcePath).text(), filepath: sourcePath }
}
