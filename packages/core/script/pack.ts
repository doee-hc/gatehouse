#!/usr/bin/env bun
import path from "node:path"

const coreRoot = path.resolve(import.meta.dir, "..")

async function run(cwd: string, cmd: string[], label: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${label} failed (exit ${code})`)
}

await run(coreRoot, ["bun", "run", "build"], "gatehouse build")

const proc = Bun.spawn(["bun", "pm", "pack"], { cwd: coreRoot, stdout: "pipe", stderr: "inherit" })
const output = await new Response(proc.stdout).text()
const code = await proc.exited
if (code !== 0) throw new Error("bun pm pack failed")

const match = output.match(/(gatehouse-core-[^\s]+\.tgz)/)
const archive = match?.[1] ?? "gatehouse-core-0.1.0.tgz"
const archivePath = path.join(coreRoot, archive)

console.log("")
console.log(`[gatehouse] packed ${archivePath}`)
console.log("[gatehouse] install on another machine (OpenCode 1.16+):")
console.log(`  tar -xzf ${archive} && bun ./package/bin/gatehouse.ts install ${archivePath}`)
console.log("[gatehouse] do NOT use: opencode plug file:...tgz (npm download, no progress, often hangs)")
console.log("[gatehouse] do NOT use: opencode plug ./gatehouse-core-*.tgz (imports archive, never loads)")
