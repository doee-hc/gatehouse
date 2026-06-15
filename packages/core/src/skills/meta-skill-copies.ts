import { cpSync, existsSync, lstatSync, rmSync } from "node:fs"
import path from "node:path"
import { readLocaleSync, type GatehouseLocale } from "../locale.ts"
import { gatehouseLocaleRoot, gatehouseRoot } from "../paths.ts"
import { GATEHOUSE_META_SKILL_NAMES } from "./constants.ts"

function localeMetaSkillDir(projectDirectory: string, locale: GatehouseLocale, skillName: string) {
  return path.join(gatehouseLocaleRoot(projectDirectory, locale), "skills", skillName)
}

function metaSkillCopyDest(projectDirectory: string, skillName: string) {
  return path.join(gatehouseRoot(projectDirectory), "skills", skillName)
}

/**
 * Copy `.gatehouse/<locale>/skills/<name>` → `.gatehouse/skills/<name>` so OpenCode's
 * `skills.paths: [".gatehouse"]` glob finds meta skills. Skips when the destination
 * already exists (user overrides). Replaces legacy symlinks from older Gatehouse versions.
 */
export function ensureMetaSkillCopies(projectDirectory: string, locale?: GatehouseLocale) {
  const loc = locale ?? readLocaleSync(projectDirectory)

  for (const name of GATEHOUSE_META_SKILL_NAMES) {
    const source = localeMetaSkillDir(projectDirectory, loc, name)
    if (!existsSync(path.join(source, "SKILL.md"))) continue

    const dest = metaSkillCopyDest(projectDirectory, name)
    if (existsSync(dest)) {
      if (lstatSync(dest).isSymbolicLink()) {
        rmSync(dest)
        cpSync(source, dest, { recursive: true })
      }
      continue
    }

    cpSync(source, dest, { recursive: true })
  }
}
