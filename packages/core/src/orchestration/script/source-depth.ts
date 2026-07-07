/** Shared paren/brace/string depth for orchestration source analysis. */
export function parenBraceDepthBefore(source: string, index: number) {
  let depth = 0
  let inString: '"' | "'" | "`" | null = null
  let escape = false
  for (let i = 0; i < index; i += 1) {
    const ch = source[i]!
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === "\\") escape = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch
      continue
    }
    if (ch === "(" || ch === "{") depth += 1
    else if (ch === ")" || ch === "}") depth -= 1
  }
  return depth
}
