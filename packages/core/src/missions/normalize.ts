export type MissionOverrideFields = {
  notes?: string
  user_topology?: string
  user_skill?: string
}

/** Trim empty override fields; notes and dedicated fields are stored as-is. */
export function normalizeMissionOverrideFields(fields: MissionOverrideFields): MissionOverrideFields {
  const notes = fields.notes?.trim() || undefined
  const user_topology = fields.user_topology?.trim() || undefined
  const user_skill = fields.user_skill?.trim() || undefined
  return {
    ...(notes && { notes }),
    ...(user_topology && { user_topology }),
    ...(user_skill && { user_skill }),
  }
}
