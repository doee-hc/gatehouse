const READING_TOOLS = /^(rag_|read$|grep|webfetch|glob|list$|search)/i

export function classifyToolActivity(toolName: string | undefined): "reading" | "typing" | undefined {
  if (!toolName) return undefined
  const base = toolName.split(".")[0] ?? toolName
  if (READING_TOOLS.test(base) || READING_TOOLS.test(toolName)) return "reading"
  return "typing"
}

export function portalAgentStatus(input: {
  sessionStatus?: string
  lastTool?: string
}): "idle" | "busy" | "research" {
  const raw = input.sessionStatus
  if (raw !== "busy" && raw !== "retry") return "idle"
  if (classifyToolActivity(input.lastTool) === "reading") return "research"
  return "busy"
}
