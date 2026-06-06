import path from "node:path"
import { loadCharacterRoles } from "./character-roles.ts"

const pkgRoot = path.join(import.meta.dir, "..")
const assetsRoot = path.join(pkgRoot, "public", "assets", "characters", "sheets")
const roles = await loadCharacterRoles(pkgRoot)

for (const role of roles) {
  const png = path.join(assetsRoot, `${role}-1x1.png`)
  const json = path.join(assetsRoot, `${role}-1x1.json`)
  if (!(await Bun.file(png).exists()) || !(await Bun.file(json).exists())) {
    console.error(`ensure-assets: missing sheets/${role}-1x1.{png,json}`)
    console.error("Generate locally: bun run --cwd packages/character-assets generate:all")
    console.error("Or migrate preview: bun run --cwd packages/character-assets migrate:preview && bun run --cwd packages/character-assets sync:portal")
    process.exit(1)
  }
}

console.log(`ensure-assets: ok (${roles.length} character sheets)`)
