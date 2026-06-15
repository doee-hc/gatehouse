import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "../paths.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"

export type AutopilotDocument = {
  schema_version: number
  enabled: boolean
  enabled_at?: string
  enabled_by?: string
}

export function autopilotPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "lead", "autopilot.yaml")
}

function parseAutopilotDocument(raw: unknown): AutopilotDocument {
  if (!isRecord(raw)) {
    return { schema_version: 1, enabled: false }
  }
  return {
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
    enabled: raw.enabled === true,
    ...(readString(raw.enabled_at) && { enabled_at: readString(raw.enabled_at) }),
    ...(readString(raw.enabled_by) && { enabled_by: readString(raw.enabled_by) }),
  }
}

export async function readAutopilotDocument(projectDirectory: string): Promise<AutopilotDocument> {
  const file = Bun.file(autopilotPath(projectDirectory))
  if (!(await file.exists())) {
    return { schema_version: 1, enabled: false }
  }
  return parseAutopilotDocument(parseYaml(await file.text()))
}

export function readAutopilotDocumentSync(projectDirectory: string): AutopilotDocument {
  const filePath = autopilotPath(projectDirectory)
  if (!existsSync(filePath)) {
    return { schema_version: 1, enabled: false }
  }
  return parseAutopilotDocument(parseYaml(readFileSync(filePath, "utf8")))
}

export async function writeAutopilotDocument(projectDirectory: string, doc: AutopilotDocument) {
  const filePath = autopilotPath(projectDirectory)
  await Bun.$`mkdir -p ${path.dirname(filePath)}`.quiet()
  await Bun.write(
    filePath,
    Bun.YAML.stringify({
      schema_version: 1,
      enabled: doc.enabled,
      ...(doc.enabled_at && { enabled_at: doc.enabled_at }),
      ...(doc.enabled_by && { enabled_by: doc.enabled_by }),
    }),
  )
}

export function autopilotIsEnabled(doc: AutopilotDocument) {
  return doc.enabled === true
}

export async function setAutopilotEnabled(input: {
  projectDirectory: string
  enabled: boolean
  enabledBy?: string
}) {
  const doc: AutopilotDocument = {
    schema_version: 1,
    enabled: input.enabled,
    ...(input.enabled
      ? {
          enabled_at: new Date().toISOString(),
          ...(input.enabledBy && { enabled_by: input.enabledBy }),
        }
      : {}),
  }
  await writeAutopilotDocument(input.projectDirectory, doc)
  return doc
}
