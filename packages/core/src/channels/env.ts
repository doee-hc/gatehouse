export async function loadDotEnv(candidates: string[]) {
  for (const envPath of candidates) {
    const file = Bun.file(envPath)
    if (!(await file.exists())) continue
    const text = await file.text()
    if (!text.trim()) continue
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
    return
  }
}
