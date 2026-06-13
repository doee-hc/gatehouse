import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

export type DirectionStatus = "draft" | "confirmed"

export type DirectionDocument = {
  schema_version: number
  status: DirectionStatus
  summary?: string
  constraints: string[]
  confirmed_at?: string
  confirmed_by?: string
  review_after?: string
}

export function directionPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "lead", "direction.yaml")
}

function parseDirectionDocument(raw: unknown): DirectionDocument {
  if (!isRecord(raw)) {
    return { schema_version: 1, status: "draft", constraints: [] }
  }
  const status = readString(raw.status)
  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
    status: status === "confirmed" ? "confirmed" : "draft",
    ...(readString(raw.summary) && { summary: readString(raw.summary) }),
    constraints,
    ...(readString(raw.confirmed_at) && { confirmed_at: readString(raw.confirmed_at) }),
    ...(readString(raw.confirmed_by) && { confirmed_by: readString(raw.confirmed_by) }),
    ...(readString(raw.review_after) && { review_after: readString(raw.review_after) }),
  }
}

export async function readDirectionDocument(projectDirectory: string): Promise<DirectionDocument> {
  const file = Bun.file(directionPath(projectDirectory))
  if (!(await file.exists())) {
    return { schema_version: 1, status: "draft", constraints: [] }
  }
  return parseDirectionDocument(parseYaml(await file.text()))
}

export function directionIsConfirmed(doc: DirectionDocument) {
  return doc.status === "confirmed"
}
