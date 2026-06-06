export function parseYaml(text: string): unknown {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.parse === "function") {
    return Bun.YAML.parse(text)
  }
  throw new Error("Bun.YAML.parse is required to read Gatehouse tree files")
}

export function stringifyYaml(value: unknown) {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.stringify === "function") {
    return Bun.YAML.stringify(value)
  }
  throw new Error("Bun.YAML.stringify is required to write Gatehouse tree files")
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
