import manifest from "../../public/assets/characters/manifest.json"

export const CHARACTER_MANIFEST = manifest

export type OuterRoleId = "lead" | "architect" | "curator" | "arbiter"

export const OUTER_ROLE_IDS = manifest.outerRoles as readonly OuterRoleId[]

export const INNER_POOL_SIZE = manifest.poolSize

export type InnerPoolPrefix = `${typeof manifest.poolPrefix}-${string}`

export function formatPoolPrefix(index: number): InnerPoolPrefix {
  return `${manifest.poolPrefix}-${String(index).padStart(2, "0")}` as InnerPoolPrefix
}

export const INNER_POOL_PREFIXES = Array.from({ length: INNER_POOL_SIZE }, (_, i) =>
  formatPoolPrefix(i + 1),
) as readonly InnerPoolPrefix[]

export const ALL_CHARACTER_SHEET_PREFIXES = [...OUTER_ROLE_IDS, ...INNER_POOL_PREFIXES] as const
