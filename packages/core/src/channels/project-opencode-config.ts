import path from "node:path"

/** Project OpenCode config — always project root `opencode.jsonc`. */
export function projectOpencodeConfigPath(projectRoot: string) {
  return path.join(path.resolve(projectRoot), "opencode.jsonc")
}

export async function readProjectOpencodeConfigText(projectRoot: string) {
  const configPath = projectOpencodeConfigPath(projectRoot)
  if (!(await Bun.file(configPath).exists())) return null
  return { text: await Bun.file(configPath).text(), filepath: configPath }
}
