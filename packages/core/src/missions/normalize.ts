/** Legacy notes prefixes (schema v2); migrated into dedicated fields on read. */
export const LEGACY_TOPOLOGY_NOTE_PREFIXES = ["[用户指定·拓扑]", "[user-specified·topology]"] as const
export const LEGACY_SKILL_NOTE_PREFIXES = ["[用户指定·skill]", "[user-specified·skill]"] as const

function parsePrefixedLine(line: string, prefixes: readonly string[]) {
  const trimmed = line.trimStart()
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim()
    }
  }
  return undefined
}

export type MissionOverrideFields = {
  notes?: string
  user_topology?: string
  user_skill?: string
}

/** Split legacy prefixed notes into user_topology / user_skill; trim empty override fields. */
export function normalizeMissionOverrideFields(fields: MissionOverrideFields): MissionOverrideFields {
  let user_topology = fields.user_topology?.trim() || undefined
  let user_skill = fields.user_skill?.trim() || undefined
  const notes = fields.notes

  if (!notes?.trim()) {
    return {
      ...(notes?.trim() && { notes: notes.trim() }),
      ...(user_topology && { user_topology }),
      ...(user_skill && { user_skill }),
    }
  }

  const backgroundLines: string[] = []
  for (const line of notes.split("\n")) {
    if (!user_topology) {
      const topo = parsePrefixedLine(line, LEGACY_TOPOLOGY_NOTE_PREFIXES)
      if (topo !== undefined) {
        if (topo) user_topology = topo
        continue
      }
    }
    if (!user_skill) {
      const skill = parsePrefixedLine(line, LEGACY_SKILL_NOTE_PREFIXES)
      if (skill !== undefined) {
        if (skill) user_skill = skill
        continue
      }
    }
    backgroundLines.push(line)
  }

  const cleanedNotes = backgroundLines.join("\n").trim()
  return {
    ...(cleanedNotes && { notes: cleanedNotes }),
    ...(user_topology && { user_topology }),
    ...(user_skill && { user_skill }),
  }
}
