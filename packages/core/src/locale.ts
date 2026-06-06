import { loadGatehouseConfig } from "./gatehouse-config.ts"

export type GatehouseLocale = "zh" | "en"

export const GATEHOUSE_LOCALES: GatehouseLocale[] = ["zh", "en"]

export const DEFAULT_GATEHOUSE_LOCALE: GatehouseLocale = "zh"

export function normalizeGatehouseLocale(value: unknown): GatehouseLocale | undefined {
  if (value === "zh" || value === "en") return value
  return undefined
}

export function readLocaleSync(projectDirectory: string): GatehouseLocale {
  return loadGatehouseConfig(projectDirectory).locale
}
