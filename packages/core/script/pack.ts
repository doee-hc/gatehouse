#!/usr/bin/env bun
import path from "node:path"

const coreRoot = path.resolve(import.meta.dir, "..")
const channelsCoreRoot = path.resolve(coreRoot, "../channels-core")

async function assertPublishableDependency() {
  const [corePkg, channelsPkg] = await Promise.all([
    Bun.file(path.join(coreRoot, "package.json")).json() as Promise<{
      dependencies?: Record<string, string>
    }>,
    Bun.file(path.join(channelsCoreRoot, "package.json")).json() as Promise<{ version?: string }>,
  ])
  const dep = corePkg.dependencies?.["@gatehouse/channels-core"]
  if (!dep || dep.startsWith("workspace:")) {
    throw new Error(
      "@gatehouse/core must depend on a published @gatehouse/channels-core version (not workspace:*) before pack/publish",
    )
  }
  if (channelsPkg.version && dep !== channelsPkg.version) {
    throw new Error(
      `@gatehouse/core depends on @gatehouse/channels-core@${dep}, but packages/channels-core is ${channelsPkg.version}`,
    )
  }
}

async function run(cwd: string, cmd: string[], label: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${label} failed (exit ${code})`)
}

await assertPublishableDependency()
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
