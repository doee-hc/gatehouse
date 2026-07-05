import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gatehouseRoot } from "../supervisor/config.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseYaml(text: string): unknown {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.parse === "function") {
    return Bun.YAML.parse(text)
  }
  throw new Error("Bun.YAML.parse is required to read Gatehouse YAML config")
}

function stringifyYaml(value: unknown) {
  if (typeof Bun !== "undefined" && "YAML" in Bun && typeof Bun.YAML.stringify === "function") {
    return `${Bun.YAML.stringify(value, null, 2)}\n`
  }
  throw new Error("Bun.YAML.stringify is required to write Gatehouse YAML config")
}

export function generatePortalAdminKey() {
  return crypto.randomBytes(32).toString("base64url")
}

export function gatehouseConfigPath(projectDir: string) {
  return path.join(gatehouseRoot(projectDir), "config.yaml")
}

export function readPortalAdminKeyFromConfig(projectDir: string) {
  const configPath = gatehouseConfigPath(projectDir)
  if (!fs.existsSync(configPath)) return ""

  const raw = parseYaml(fs.readFileSync(configPath, "utf-8"))
  if (!isRecord(raw)) throw new Error(`${configPath} must be a YAML mapping`)

  const portal = raw.portal
  if (!isRecord(portal)) return ""

  const adminKey = typeof portal.admin_key === "string" ? portal.admin_key.trim() : ""
  return adminKey
}

export function resolvePortalAdminKey(projectDir: string) {
  const fromEnv = process.env.GATEHOUSE_PORTAL_ADMIN_KEY?.trim()
  if (fromEnv) return fromEnv
  return readPortalAdminKeyFromConfig(projectDir)
}

export function isPortalAdminConfigured(projectDir: string) {
  return Boolean(resolvePortalAdminKey(projectDir))
}

/** Ensure `.gatehouse/config.yaml` has `portal.admin_key`. */
export function ensurePortalAdminKey(projectDir: string) {
  const fromEnv = process.env.GATEHOUSE_PORTAL_ADMIN_KEY?.trim()
  if (fromEnv) return fromEnv

  const existing = readPortalAdminKeyFromConfig(projectDir)
  if (existing) return existing

  const key = generatePortalAdminKey()
  const configPath = gatehouseConfigPath(projectDir)
  if (!fs.existsSync(configPath)) {
    return key
  }

  const raw = parseYaml(fs.readFileSync(configPath, "utf-8"))
  if (!isRecord(raw)) throw new Error(`${configPath} must be a YAML mapping`)

  const portal = isRecord(raw.portal) ? { ...raw.portal } : {}
  portal.admin_key = key
  raw.portal = portal
  fs.writeFileSync(configPath, stringifyYaml(raw), "utf-8")
  return key
}
