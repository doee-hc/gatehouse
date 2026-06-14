#!/usr/bin/env bun
import path from "node:path"
import { existsSync } from "node:fs"
import { cp as cpAsync, mkdir, rm } from "node:fs/promises"
import { portalStaticOfflineCacheDir } from "../src/paths.ts"

const coreRoot = path.resolve(import.meta.dir, "..")
const portalRoot = path.resolve(coreRoot, "../portal")
const distRoot = path.join(coreRoot, "dist")
const portalDist = path.join(distRoot, "portal")
const bridgesRoot = path.join(coreRoot, "bridges")

const BUNDLED_BRIDGE_PACKAGES = ["weixin-bridge", "feishu-bridge", "qq-bridge", "qq-onebot-bridge"] as const

async function run(cwd: string, cmd: string[], label: string, env?: Record<string, string | undefined>) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${label} failed (exit ${code})`)
}

async function main() {
  console.log("[gatehouse] ensuring portal assets…")
  await run(portalRoot, ["bun", "script/ensure-assets.ts"], "portal ensure-assets")
  console.log("[gatehouse] building portal UI (vite)…")
  await run(
    portalRoot,
    ["bun", "run", "build"],
    "portal vite build",
    {
      ...process.env,
      VITE_GATEHOUSE_RAG_UI: "0",
    },
  )
  await rm(portalDist, { recursive: true, force: true })
  await mkdir(distRoot, { recursive: true })
  await cpAsync(path.join(portalRoot, "dist"), portalDist, { recursive: true })
  console.log("[gatehouse] portal UI → dist/portal/")

  const projectDir = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (projectDir) {
    const bundlePath = path.join(portalStaticOfflineCacheDir(projectDir), "bundle.json")
    if (existsSync(bundlePath)) {
      const destDir = path.join(portalDist, "offline-cache")
      await mkdir(destDir, { recursive: true })
      await cpAsync(bundlePath, path.join(destDir, "bundle.json"))
      console.log("[gatehouse] portal offline cache → dist/portal/offline-cache/bundle.json")
    }
  }

  await rm(bridgesRoot, { recursive: true, force: true })
  for (const name of BUNDLED_BRIDGE_PACKAGES) {
    const src = path.join(coreRoot, "..", name, "src")
    const dest = path.join(bridgesRoot, name, "src")
    await cpAsync(src, dest, { recursive: true })
  }
  console.log("[gatehouse] IM bridge sources → bridges/")

  console.log("[gatehouse] OpenCode plugins load from src/ (Bun + TypeScript)")
}

await main()
