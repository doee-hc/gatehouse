import path from "node:path"
import { prepareGatehouseProject } from "../setup/project.ts"
import { optionValue, parseCliArgs } from "./parse-args.ts"

export async function runGatehouseScaffold(rawArgs: string[] = []) {
  const args = parseCliArgs(rawArgs)
  const projectDir = path.resolve(optionValue(args, "project") ?? args.positional[0] ?? process.cwd())
  await prepareGatehouseProject(projectDir)
  console.log(`[gatehouse] scaffolded project layout under ${projectDir}`)
  console.log("  .gatehouse/ — agent prompts, config, registry")
  console.log("  opencode.jsonc — default_agent=lead, skills.paths=[\".gatehouse\"]")
  console.log("")
  console.log("Next: cd to the project and run opencode")
}

export function printScaffoldHelp() {
  console.log(`Usage:
  bunx @gatehouse/core scaffold [-C project]

Options:
  -C, --project <dir>   Project root (default: current directory)

Examples:
  bunx @gatehouse/core scaffold
  bunx @gatehouse/core scaffold -C /path/to/project
`)
}
