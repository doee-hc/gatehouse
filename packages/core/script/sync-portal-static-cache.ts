#!/usr/bin/env bun
/**
 * Copy project static offline cache into dist/portal/offline-cache/ (or a custom target).
 *
 * Usage:
 *   GATEHOUSE_PROJECT_DIR=/path/to/project bun script/sync-portal-static-cache.ts
 *   GATEHOUSE_PROJECT_DIR=/path/to/project bun script/sync-portal-static-cache.ts /var/www/gatehouse-portal/offline-cache
 */
import path from "node:path"
import { cp, existsSync, mkdirSync } from "node:fs"
import { portalStaticOfflineCacheDir } from "../src/paths.ts"

const coreRoot = path.resolve(import.meta.dir, "..")
const projectDir = process.env.GATEHOUSE_PROJECT_DIR?.trim()
if (!projectDir) {
  console.error("GATEHOUSE_PROJECT_DIR is required")
  process.exit(1)
}

const source = path.join(portalStaticOfflineCacheDir(projectDir), "bundle.json")
if (!existsSync(source)) {
  console.error(`No static offline cache at ${source}`)
  console.error("Start Portal API once while online, or visit the portal to seed cache.")
  process.exit(1)
}

const targetArg = process.argv[2]?.trim()
const targetDir = targetArg
  ? path.resolve(targetArg)
  : path.join(coreRoot, "dist", "portal", "offline-cache")
mkdirSync(targetDir, { recursive: true })
cp(source, path.join(targetDir, "bundle.json"))
console.log(`[gatehouse/portal] offline cache → ${path.join(targetDir, "bundle.json")}`)
