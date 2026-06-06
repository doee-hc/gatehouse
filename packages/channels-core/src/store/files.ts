import fs from "node:fs"
import path from "node:path"

export function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined
  const text = fs.readFileSync(filePath, "utf-8").trim()
  if (!text) return undefined
  return JSON.parse(text) as T
}

export function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}
