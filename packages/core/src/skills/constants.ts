/** Gatehouse role skill ids (OpenCode `name` === directory name under `.gatehouse/skills/`). */

export const GATEHOUSE_ROLE_SKILLS = {
  lead: "lead-meta",
  architect: "architect-meta",
  curator: "curator-meta",
  arbiter: "arbiter-meta",
} as const

export const GATEHOUSE_RETRO_TOOLKIT_SKILL = "retro-toolkit"

/** Meta skills mirrored under `.gatehouse/skills/` for OpenCode discovery (copy from locale tree). */
export const GATEHOUSE_META_SKILL_NAMES = [
  GATEHOUSE_ROLE_SKILLS.lead,
  GATEHOUSE_ROLE_SKILLS.architect,
  GATEHOUSE_ROLE_SKILLS.curator,
  GATEHOUSE_ROLE_SKILLS.arbiter,
  GATEHOUSE_RETRO_TOOLKIT_SKILL,
  "retro-analyst-meta",
] as const

export const OUTER_PROFILE_SKILL_DIRS: Record<string, string[]> = {
  lead: [GATEHOUSE_ROLE_SKILLS.lead],
  architect: [GATEHOUSE_ROLE_SKILLS.architect, GATEHOUSE_RETRO_TOOLKIT_SKILL],
  curator: [GATEHOUSE_ROLE_SKILLS.curator],
  arbiter: [GATEHOUSE_ROLE_SKILLS.arbiter],
}

export type OuterProfileSkillRole = keyof typeof GATEHOUSE_ROLE_SKILLS

export function outerProfileSkillPermissions(role: OuterProfileSkillRole) {
  const deny = { "*": "deny" as const }
  switch (role) {
    case "lead":
      return { ...deny, [GATEHOUSE_ROLE_SKILLS.lead]: "allow" as const }
    case "architect":
      return {
        ...deny,
        [GATEHOUSE_ROLE_SKILLS.architect]: "allow" as const,
        [GATEHOUSE_RETRO_TOOLKIT_SKILL]: "allow" as const,
      }
    case "curator":
      return { ...deny, [GATEHOUSE_ROLE_SKILLS.curator]: "allow" as const }
    case "arbiter":
      return { ...deny, [GATEHOUSE_ROLE_SKILLS.arbiter]: "allow" as const }
  }
}

/** Inner execution / retro sessions: domain skills only — hide outer role meta-skills. */
export function innerExecutionSkillPermissions() {
  return {
    "*": "allow" as const,
    [GATEHOUSE_ROLE_SKILLS.lead]: "deny" as const,
    [GATEHOUSE_ROLE_SKILLS.architect]: "deny" as const,
    [GATEHOUSE_ROLE_SKILLS.curator]: "deny" as const,
    [GATEHOUSE_ROLE_SKILLS.arbiter]: "deny" as const,
  }
}

/** Extract / verify sessions: domain skills only — no retro toolkit or outer meta-skills. */
export function innerPipelineSkillPermissions() {
  return {
    ...innerExecutionSkillPermissions(),
    [GATEHOUSE_RETRO_TOOLKIT_SKILL]: "deny" as const,
  }
}
