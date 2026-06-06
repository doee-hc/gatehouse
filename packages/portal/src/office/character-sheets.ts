import { ALL_CHARACTER_SHEET_PREFIXES, type InnerPoolPrefix } from "./character-manifest.ts"
import { type CharacterAtlasPrefix, OUTER_ATLAS_PREFIXES } from "./characters.ts"

export const CHARACTER_SHEET_DIR = "assets/characters/sheets"

export const CHARACTER_SHEET_ROLES = ALL_CHARACTER_SHEET_PREFIXES satisfies readonly CharacterAtlasPrefix[]

export { OUTER_ATLAS_PREFIXES }
export type { InnerPoolPrefix }

export function characterSheetTextureKey(prefix: CharacterAtlasPrefix) {
  return `char-${prefix}`
}

export function characterSheetAtlasPaths(prefix: CharacterAtlasPrefix) {
  const file = `${prefix}-1x1`
  const base = `${CHARACTER_SHEET_DIR}/${file}`
  return { png: `${base}.png`, json: `${base}.json`, file }
}
