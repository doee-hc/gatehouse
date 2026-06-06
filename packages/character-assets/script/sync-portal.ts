/**
 * Copy composed outer + pool sheets into portal public assets (ship-ready PNG+JSON only).
 */
import path from "node:path"
import { readdir } from "node:fs/promises"

const pkgRoot = path.join(import.meta.dir, "..")
const portalSheets = path.resolve(pkgRoot, "../portal/public/assets/characters/sheets")

async function copyRoleSheets(fromDir: string, label: string) {
  let copied = 0
  for (const file of await readdir(fromDir)) {
    if (!file.endsWith("-1x1.png") && !file.endsWith("-1x1.json")) continue
    await Bun.write(path.join(portalSheets, file), Bun.file(path.join(fromDir, file)))
    copied += 1
  }
  console.log(`[sync:portal] ${label}: ${copied} files from ${fromDir}`)
}

await copyRoleSheets(path.join(pkgRoot, "assets/outer"), "outer")
await copyRoleSheets(path.join(pkgRoot, "assets/pool"), "pool")
console.log(`[sync:portal] done → ${portalSheets}`)
