/**
 * Role ids for shipped character sheets (outer fixed + inner pool).
 * Keep in sync with public/assets/characters/manifest.json.
 */
import path from "node:path"

type CharacterManifest = {
  outerRoles: string[]
  poolSize: number
  poolPrefix: string
}

export async function loadCharacterRoles(pkgRoot: string): Promise<string[]> {
  const manifestPath = path.join(pkgRoot, "public", "assets", "characters", "manifest.json")
  const manifest = (await Bun.file(manifestPath).json()) as CharacterManifest
  const pool = Array.from({ length: manifest.poolSize }, (_, i) =>
    `${manifest.poolPrefix}-${String(i + 1).padStart(2, "0")}`,
  )
  return [...manifest.outerRoles, ...pool]
}
