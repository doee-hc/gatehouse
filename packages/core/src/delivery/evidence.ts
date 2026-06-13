import type { DeliveryEvidence } from "./types.ts"

function parseEvidenceArray(parsed: unknown): DeliveryEvidence[] {
  if (!Array.isArray(parsed)) throw new Error("evidence must be a JSON array")
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const criterion_id = typeof record.criterion_id === "number" ? record.criterion_id : undefined
    const status = typeof record.status === "string" ? record.status : undefined
    if (criterion_id === undefined || !status) return []
    if (!["met", "unmet", "partial", "skipped"].includes(status)) return []
    return [
      {
        criterion_id,
        status: status as DeliveryEvidence["status"],
        ...(typeof record.proof === "string" && { proof: record.proof }),
      },
    ]
  })
}

/** Accept JSON string or array — agents often pass structured evidence as an object. */
export function parseEvidenceInput(raw: unknown): DeliveryEvidence[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    return parseEvidenceArray(JSON.parse(raw))
  }
  if (Array.isArray(raw)) return parseEvidenceArray(raw)
  throw new Error("evidence must be a JSON array string or array")
}
