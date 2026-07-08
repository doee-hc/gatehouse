export type SkillDomainAssignmentEntry = {
  node_id: string
  domain_id: string
}

export function parseSkillDomainAssignments(raw: unknown): Record<string, string> {
  if (typeof raw === "string") {
    if (!raw.trim()) throw new Error("assignments must not be empty")
    return parseSkillDomainAssignments(JSON.parse(raw) as unknown)
  }

  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue
      const nodeId = "node_id" in entry && typeof entry.node_id === "string" ? entry.node_id.trim() : ""
      const domainId =
        "domain_id" in entry && typeof entry.domain_id === "string" ? entry.domain_id.trim() : ""
      if (!nodeId || !domainId) continue
      out[nodeId] = domainId
    }
    if (Object.keys(out).length === 0) {
      throw new Error("assignments array must include at least one { node_id, domain_id } pair")
    }
    return out
  }

  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const [nodeId, domainId] of Object.entries(raw)) {
      if (typeof domainId !== "string" || !domainId.trim()) continue
      out[nodeId] = domainId.trim()
    }
    if (Object.keys(out).length === 0) {
      throw new Error("assignments object must map node_id to non-empty domain_id")
    }
    return out
  }

  throw new Error("assignments must be an array of { node_id, domain_id }, a JSON string, or an object map")
}
