import { GATEHOUSE_LOCALES } from "../locale.ts"
import {
  GATEHOUSE_RETRO_TOOLKIT_SKILL,
  GATEHOUSE_ROLE_SKILLS,
} from "../skills/constants.ts"

/** OpenCode path permission rule map — last matching pattern wins; put `"*"` first. */
export type PathPermissionRule = "allow" | "deny" | "ask"
export type PathPermissionMap = Record<string, PathPermissionRule>

const GH = ".gatehouse"

function localePatterns(suffix: string) {
  return GATEHOUSE_LOCALES.map((locale) => `${GH}/${locale}/${suffix}`)
}

function metaSkillPatterns(skillName: string) {
  return [`${GH}/skills/${skillName}/**`, ...localePatterns(`skills/${skillName}/**`)]
}

function promptRolePatterns(role: "lead" | "architect" | "curator") {
  return localePatterns(`prompts/${role}/**`)
}

const OTHER_OUTER_META_SKILLS = [
  GATEHOUSE_ROLE_SKILLS.lead,
  GATEHOUSE_ROLE_SKILLS.architect,
  GATEHOUSE_ROLE_SKILLS.curator,
  GATEHOUSE_ROLE_SKILLS.arbiter,
] as const

function denyOtherOuterMetaSkills(allowed: (typeof OTHER_OUTER_META_SKILLS)[number]) {
  return OTHER_OUTER_META_SKILLS.filter((name) => name !== allowed).flatMap((name) =>
    metaSkillPatterns(name),
  )
}

function denyOuterPromptRoles(...allowed: ("lead" | "architect" | "curator")[]) {
  const blocked = (["lead", "architect", "curator"] as const).filter((role) => !allowed.includes(role))
  return blocked.flatMap((role) => promptRolePatterns(role))
}

/** Workspace allow → blanket `.gatehouse/**` deny → optional extra denies → explicit allows (last wins). */
function gatehouseRules(allows: string[], extraDenies: string[] = []): PathPermissionMap {
  const rules: PathPermissionMap = {
    "*": "allow",
    [`${GH}/**`]: "deny",
    [`${GH}/registry.db`]: "deny",
    [`${GH}/internal/**`]: "deny",
  }
  for (const pattern of extraDenies) rules[pattern] = "deny"
  for (const pattern of allows) rules[pattern] = "allow"
  return rules
}

function filesystemPathPermissions(read: PathPermissionMap, edit: PathPermissionMap = read) {
  return {
    read,
    grep: read,
    glob: read,
    list: read,
    edit,
    write: edit,
  } as const
}

const retroToolkitPatterns = [
  `${GH}/skills/${GATEHOUSE_RETRO_TOOLKIT_SKILL}/**`,
  ...localePatterns(`skills/${GATEHOUSE_RETRO_TOOLKIT_SKILL}/**`),
]

/** profile lead — queue, direction, read-only mission reports; no architect/curator meta or prompts. */
export const leadFilesystemPermissions = filesystemPathPermissions(
  gatehouseRules(
    [
      `${GH}/config.yaml`,
      `${GH}/lead/**`,
      `${GH}/missions/**/reports/**`,
      `${GH}/missions/**/delivery.yaml`,
      `${GH}/skills/domains.yaml`,
      ...metaSkillPatterns(GATEHOUSE_ROLE_SKILLS.lead),
    ],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.lead), ...denyOuterPromptRoles("lead")],
  ),
  gatehouseRules([`${GH}/lead/**`], [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.lead)]),
)

/** profile architect — mission trees, architect prompts/skills, retro toolkit. */
export const architectFilesystemPermissions = filesystemPathPermissions(
  gatehouseRules(
    [
      `${GH}/config.yaml`,
      `${GH}/missions/**`,
      ...metaSkillPatterns(GATEHOUSE_ROLE_SKILLS.architect),
      ...retroToolkitPatterns,
      ...promptRolePatterns("architect"),
    ],
    [
      ...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect),
      ...denyOuterPromptRoles("architect"),
      `${GH}/lead/**`,
      `${GH}/arbiter/**`,
      `${GH}/skills/by-domain/**`,
      `${GH}/skills/domains.yaml`,
    ],
  ),
  gatehouseRules(
    [
      `${GH}/missions/**`,
      ...retroToolkitPatterns,
      ...promptRolePatterns("architect"),
    ],
    [
      ...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect),
      `${GH}/lead/**`,
      `${GH}/arbiter/**`,
      `${GH}/skills/**`,
    ],
  ),
)

/** profile curator — domain skills, skill pipeline reports, curator meta; no lead queue or mission scripts. */
export const curatorFilesystemPermissions = filesystemPathPermissions(
  gatehouseRules(
    [
      `${GH}/config.yaml`,
      `${GH}/skills/by-domain/**`,
      `${GH}/skills/domains.yaml`,
      ...metaSkillPatterns(GATEHOUSE_ROLE_SKILLS.curator),
      `${GH}/missions/**/reports/**`,
      ...localePatterns("prompts/architect/domain-skill-extract.md"),
      ...promptRolePatterns("curator"),
    ],
    [
      ...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.curator),
      ...denyOuterPromptRoles("curator"),
      `${GH}/lead/**`,
      `${GH}/arbiter/**`,
      `${GH}/missions/**/mission.script.ts`,
      `${GH}/missions/**/context/**`,
      ...retroToolkitPatterns,
    ],
  ),
  gatehouseRules(
    [
      `${GH}/skills/by-domain/**`,
      `${GH}/skills/domains.yaml`,
      ...metaSkillPatterns(GATEHOUSE_ROLE_SKILLS.curator),
      ...localePatterns("prompts/architect/domain-skill-extract.md"),
      `${GH}/missions/**/reports/**`,
    ],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.curator), `${GH}/lead/**`, `${GH}/arbiter/**`],
  ),
)

/** profile arbiter — read-only audit across `.gatehouse/` except registry/internal. */
export const arbiterFilesystemPermissions = {
  read: {
    "*": "allow",
    [`${GH}/registry.db`]: "deny",
    [`${GH}/internal/**`]: "deny",
  },
  grep: {
    "*": "allow",
    [`${GH}/registry.db`]: "deny",
    [`${GH}/internal/**`]: "deny",
  },
  glob: {
    "*": "allow",
    [`${GH}/registry.db`]: "deny",
    [`${GH}/internal/**`]: "deny",
  },
  list: {
    "*": "allow",
    [`${GH}/registry.db`]: "deny",
    [`${GH}/internal/**`]: "deny",
  },
} as const

const innerGatehouseDenyAll: PathPermissionMap = {
  "*": "allow",
  [`${GH}/**`]: "deny",
  [`${GH}/registry.db`]: "deny",
}

/** Leaf execution — no `.gatehouse/` filesystem access; use gatehouse_mission_info + project tree. */
export const innerExecutionFilesystemPermissions = filesystemPathPermissions(innerGatehouseDenyAll)

/** Retro analyst — retro-summary, context dumps, retro toolkit. */
export const innerRetroAnalystFilesystemPermissions = filesystemPathPermissions(
  gatehouseRules(
    [
      `${GH}/missions/**/reports/retro-summary.md`,
      `${GH}/missions/**/context/**`,
      ...retroToolkitPatterns,
      ...localePatterns("prompts/architect/retro-summary.template.md"),
      ...localePatterns("prompts/architect/retro-analyst-kickoff.md"),
      ...metaSkillPatterns("retro-analyst-meta"),
    ],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect), ...promptRolePatterns("architect")],
  ),
  gatehouseRules(
    [`${GH}/missions/**/reports/retro-summary.md`, ...retroToolkitPatterns, ...metaSkillPatterns("retro-analyst-meta")],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect)],
  ),
)

/** build-extract / build-verify — skill pipeline artifacts and domain skill dirs only. */
export const innerPipelineFilesystemPermissions = filesystemPathPermissions(
  gatehouseRules(
    [
      `${GH}/missions/**/reports/skills/**`,
      `${GH}/missions/**/context/**`,
      `${GH}/skills/by-domain/**`,
      `${GH}/skills/domains.yaml`,
    ],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect), ...promptRolePatterns("architect")],
  ),
  gatehouseRules(
    [`${GH}/missions/**/reports/skills/**`, `${GH}/skills/by-domain/**`, `${GH}/skills/domains.yaml`],
    [...denyOtherOuterMetaSkills(GATEHOUSE_ROLE_SKILLS.architect)],
  ),
)
