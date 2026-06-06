import { loadGatehouseConfig } from "./gatehouse-config.ts"

export const OUTER_PROFILES = ["lead", "architect", "curator", "arbiter"] as const
export type OuterProfile = (typeof OUTER_PROFILES)[number]

export const DEFAULT_AGENT_NAMES: Record<OuterProfile, string> = {
  lead: "Lead",
  architect: "Architect",
  curator: "Curator",
  arbiter: "Arbiter",
}

export function normalizeOuterProfile(profile: string): OuterProfile | undefined {
  const trimmed = profile.trim().toLowerCase()
  if (OUTER_PROFILES.includes(trimmed as OuterProfile)) return trimmed as OuterProfile
  return undefined
}

export function defaultAgentNames() {
  return { ...DEFAULT_AGENT_NAMES }
}

export async function readAgentNames(projectDirectory: string) {
  return readAgentNamesSync(projectDirectory)
}

export function readAgentNamesSync(projectDirectory: string) {
  return loadGatehouseConfig(projectDirectory).agents
}

export function agentName(names: Record<OuterProfile, string>, profile: OuterProfile | string) {
  const normalized = normalizeOuterProfile(profile)
  if (!normalized) return profile
  return names[normalized]
}

export function outerAgentNamesLine(names: Record<OuterProfile, string>) {
  return OUTER_PROFILES.map((profile) => `${profile} (${names[profile]})`).join(" · ")
}

export function outerProfilesLine() {
  return OUTER_PROFILES.join(" / ")
}

const PROMPT_PLACEHOLDERS: Record<string, (names: Record<OuterProfile, string>) => string> = {
  "{{name}}": (names) => names.lead,
  "{{lead_name}}": (names) => names.lead,
  "{{architect_name}}": (names) => names.architect,
  "{{curator_name}}": (names) => names.curator,
  "{{arbiter_name}}": (names) => names.arbiter,
  "{{outer_names}}": outerAgentNamesLine,
  "{{profiles}}": () => outerProfilesLine(),
}

export function renderAgentPrompt(
  template: string,
  names: Record<OuterProfile, string>,
  profile?: OuterProfile,
) {
  const withProfile = profile ? template.replaceAll("{{name}}", names[profile]) : template
  return Object.entries(PROMPT_PLACEHOLDERS).reduce((text, [token, value]) => {
    if (token === "{{name}}") return text
    return text.replaceAll(token, value(names))
  }, withProfile)
}

export function renderGatehouseTemplate(template: string, names = defaultAgentNames()) {
  return renderAgentPrompt(template, names)
}
