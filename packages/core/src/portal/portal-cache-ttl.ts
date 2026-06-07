export function portalCacheTtlMs(envKey: string, fallback: number) {
  const raw = process.env[envKey]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
