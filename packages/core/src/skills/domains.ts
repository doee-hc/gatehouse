import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { gatehouseRoot, skillDomainsRegistryPath } from "../paths.ts"
import { gatehouseMessage } from "../i18n.ts"
import type { GatehouseLocale } from "../locale.ts"
import { isRecord, parseYaml, readString, stringifyYaml } from "../yaml.ts"

export type SkillDomainEntry = {
  id: string
  label?: string
  description?: string
}

export type SkillDomainRegistrySyncResult = {
  added: string[]
  updated: string[]
}

export function domainLabelFromId(id: string) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function normalizeSkillDomainEntry(entry: { id: string; label?: string; description?: string }): SkillDomainEntry {
  const id = entry.id.trim()
  const label = entry.label?.trim()
  const description = entry.description?.trim()
  return {
    id,
    label: label || domainLabelFromId(id),
    ...(description && { description }),
  }
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

export async function writeSkillDomainsRegistry(projectDirectory: string, entries: SkillDomainEntry[]) {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id))
  const payload = {
    schema_version: 1,
    domains: sorted.map((entry) => ({
      id: entry.id,
      ...(entry.label && { label: entry.label }),
      ...(entry.description && { description: entry.description }),
    })),
  }
  const filePath = skillDomainsRegistryPath(projectDirectory)
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, `${stringifyYaml(payload)}\n`)
}

export async function ensureSkillDomainsInRegistry(
  projectDirectory: string,
  hints: SkillDomainEntry[],
): Promise<SkillDomainRegistrySyncResult> {
  const existing = await readSkillDomainsRegistry(projectDirectory)
  const byId = new Map(existing.map((entry) => [entry.id, entry]))
  const added: string[] = []
  const updated: string[] = []

  for (const hint of hints) {
    const normalized = normalizeSkillDomainEntry(hint)
    const current = byId.get(normalized.id)
    if (!current) {
      byId.set(normalized.id, normalized)
      added.push(normalized.id)
      continue
    }
    const merged: SkillDomainEntry = {
      ...current,
      ...(normalized.label && !current.label && { label: normalized.label }),
      ...(normalized.description && !current.description && { description: normalized.description }),
    }
    if (merged.label !== current.label || merged.description !== current.description) {
      byId.set(normalized.id, merged)
      updated.push(normalized.id)
    }
  }

  if (added.length > 0 || updated.length > 0) {
    await writeSkillDomainsRegistry(projectDirectory, [...byId.values()])
  }

  return { added, updated }
}

export async function syncSkillDomainsRegistryFromByDomain(projectDirectory: string) {
  const byDomainRoot = path.join(gatehouseRoot(projectDirectory), "skills", "by-domain")
  const hints: SkillDomainEntry[] = []
  try {
    const entries = await readdir(byDomainRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.endsWith("-archived")) continue
      hints.push({ id: entry.name, label: domainLabelFromId(entry.name) })
    }
  } catch {
    return { added: [], updated: [] } satisfies SkillDomainRegistrySyncResult
  }
  return ensureSkillDomainsInRegistry(projectDirectory, hints)
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

export function unknownSkillDomainIds(
  assignments: Record<string, string>,
  registered: SkillDomainEntry[],
): string[] {
  const registeredIds = new Set(registered.map((entry) => entry.id))
  const unknown = new Set<string>()
  for (const domainId of Object.values(assignments)) {
    const trimmed = domainId.trim()
    if (trimmed && !registeredIds.has(trimmed)) unknown.add(trimmed)
  }
  return [...unknown].sort()
}

export function skillDomainHintsFromAssignments(
  assignments: Record<string, string>,
  hints: SkillDomainEntry[] = [],
) {
  const byId = new Map<string, SkillDomainEntry>()
  for (const entry of hints) {
    byId.set(entry.id, normalizeSkillDomainEntry(entry))
  }
  for (const domainId of new Set(Object.values(assignments).map((value) => value.trim()).filter(Boolean))) {
    if (!byId.has(domainId)) {
      byId.set(domainId, normalizeSkillDomainEntry({ id: domainId }))
    }
  }
  return [...byId.values()]
}
