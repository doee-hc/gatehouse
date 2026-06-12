const LOCAL_NO_PROXY = ["127.0.0.1", "localhost", "127.*", "[::1]"] as const
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const

function mergeNoProxy(existing?: string) {
  const parts = new Set(
    (existing ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  for (const entry of LOCAL_NO_PROXY) parts.add(entry)
  return [...parts].join(",")
}

/** Dev child processes: keep HTTP(S)_PROXY, but always bypass proxy for local OpenCode / Portal. */
export function localDevEnv(extra: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = { ...process.env, ...extra }
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) base[key] = value
  }
  const noProxy = mergeNoProxy(
    extra.NO_PROXY ??
      extra.no_proxy ??
      process.env.NO_PROXY ??
      process.env.no_proxy ??
      base.NO_PROXY ??
      base.no_proxy,
  )
  base.NO_PROXY = noProxy
  base.no_proxy = noProxy
  return base
}
