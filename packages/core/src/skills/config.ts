/** Skill pipeline tuning — quality gates, retrieval, utility pruning. */

export const SKILL_PIPELINE = {
  /** Cosine similarity above this → reject new skill or require merge. */
  maxSimilarity: 0.85,
  /** Share of product-name tokens in body above this → reject. */
  maxProductNameDensity: 0.07,
  /** Max brand/product token hits in body before rejection. */
  maxProductNameHits: 12,
  /** Hard cap on new skill directories per mission per domain. */
  maxNewSkillsPerMissionDomain: 2,
  /** Skills surfaced at execution bootstrap (semantic top-k). */
  retrievalTopK: 6,
  /** Minimum retrieval_count before a skill is considered "proven useful". */
  utilityProvenThreshold: 2,
  /** Archive when extract_count >= this and retrieval_count === 0. */
  utilityArchiveMinExtracts: 1,
} as const

/** Tokens counted toward product-name density (lowercase). */
export const SKILL_PRODUCT_TOKENS = new Set([
  "claude",
  "codex",
  "cursor",
  "copilot",
  "windsurf",
  "devin",
  "openai",
  "anthropic",
  "github",
  "dynamic",
  "workflows",
  "frontiercode",
  "fable",
  "opus",
  "gpt",
  "gemini",
  "ultracode",
  "seatbelt",
  "landlock",
  "wsl2",
  "swe-bench",
  "mission",
])
