import { skillDomainsRegistryPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

export type SkillDomainEntry = {
  id: string
  label?: string
  description?: string
}

export async function readSkillDomainsRegistry(projectDirectory: string) {
  const file = Bun.file(skillDomainsRegistryPath(projectDirectory))
  if (!(await file.exists())) return [] as SkillDomainEntry[]
  const raw = parseYaml(await file.text())
  if (!isRecord(raw) || !Array.isArray(raw.domains)) return []
  return raw.domains.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const id = readString(entry.id)
    if (!id) return []
    return [
      {
        id,
        ...(readString(entry.label) && { label: readString(entry.label) }),
        ...(readString(entry.description) && { description: readString(entry.description) }),
      },
    ]
  })
}

export function formatSkillDomainsRegistry(entries: SkillDomainEntry[], locale: GatehouseLocale) {
  if (entries.length === 0) return gatehouseMessage("domains.registry.empty", locale)
  const lines = [gatehouseMessage("domains.registry.header", locale)]
  for (const entry of entries) {
    const label = entry.label ? ` — ${entry.label}` : ""
    const description = entry.description ? ` · ${entry.description}` : ""
    lines.push(`- \`${entry.id}\`${label}${description}`)
  }
  return lines.join("\n")
}
