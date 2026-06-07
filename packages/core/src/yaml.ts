export function parseYaml(text: string): unknown {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.parse === "function") {
    return Bun.YAML.parse(text)
  }
  throw new Error("Bun.YAML.parse is required to read Gatehouse tree files")
}

function yamlNeedsQuotes(value: string) {
  if (!value) return true
  if (/^-?\d+(\.\d+)?$/.test(value)) return true
  if (/^[\s-?:,\[\]{}#&*!|>'"%@`]|:\s|#/.test(value)) return true
  if (/^(true|false|null|yes|no|on|off)$/i.test(value)) return true
  return false
}

function yamlScalar(value: string, indent: number) {
  if (!value.includes("\n")) {
    return yamlNeedsQuotes(value) ? JSON.stringify(value) : value
  }
  const pad = "  ".repeat(indent + 1)
  const lines = value.split("\n")
  const body = lines.map((line) => `${pad}${line}`).join("\n")
  return `|\n${body}`
}

function stringifyYamlBlock(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent)
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return yamlScalar(value, indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return value
      .map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const lines = stringifyYamlBlock(item, indent + 1).split("\n")
          const [first, ...rest] = lines
          return `${pad}- ${first?.trimStart() ?? ""}${rest.length > 0 ? `\n${rest.join("\n")}` : ""}`
        }
        return `${pad}- ${stringifyYamlBlock(item, indent + 1)}`
      })
      .join("\n")
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    return entries
      .map(([key, child]) => {
        const childKey = yamlNeedsQuotes(key) ? JSON.stringify(key) : key
        if (child !== null && typeof child === "object") {
          const nested = stringifyYamlBlock(child, indent + 1)
          if (Array.isArray(child)) {
            if (child.length === 0) return `${pad}${childKey}: []`
            return `${pad}${childKey}:\n${nested}`
          }
          return `${pad}${childKey}:\n${nested}`
        }
        return `${pad}${childKey}: ${stringifyYamlBlock(child, indent + 1)}`
      })
      .join("\n")
  }
  return String(value)
}

export function stringifyYaml(value: unknown) {
  return `${stringifyYamlBlock(value)}\n`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
