import { parse as parseJsonc, type ParseError } from "jsonc-parser"

export function parseJsoncConfig(text: string, filepath: string) {
  const errors: ParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error(`Failed to parse ${filepath}`)
  if (typeof data !== "object" || data === null) throw new Error(`${filepath} must be a JSON object`)
  return data as Record<string, unknown>
}
