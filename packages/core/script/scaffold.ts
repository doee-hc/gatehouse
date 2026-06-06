#!/usr/bin/env bun
import path from "node:path"
import { prepareGatehouseProject } from "../src/setup/project.ts"

const target = process.argv[2] ?? process.cwd()
if (target.startsWith("-")) {
  console.error(`Invalid project path "${target}" (looks like a CLI flag). Pass the directory explicitly.`)
  process.exit(1)
}
process.env.GATEHOUSE_LOCAL_PLUGIN = "1"
const pluginRoot = path.join(import.meta.dir, "..")
await prepareGatehouseProject(target, pluginRoot)
console.log(`Scaffolded independent Gatehouse layout under ${path.resolve(target)}`)
