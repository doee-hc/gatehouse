const DEFAULT_SSE_MAX = 500

let activeConnections = 0
let rejectedTotal = 0

function maxSseConnections() {
  const raw = process.env.GATEHOUSE_PORTAL_SSE_MAX?.trim()
  if (!raw) return DEFAULT_SSE_MAX
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_SSE_MAX
}

export function portalSseActiveCount() {
  return activeConnections
}

export function portalSseRejectedTotal() {
  return rejectedTotal
}

export function resetPortalSseRegistryForTests() {
  activeConnections = 0
  rejectedTotal = 0
}

export function acquirePortalSseConnection() {
  if (activeConnections >= maxSseConnections()) {
    rejectedTotal += 1
    return { ok: false as const }
  }
  activeConnections += 1
  return {
    ok: true as const,
    release: () => {
      activeConnections = Math.max(0, activeConnections - 1)
    },
  }
}
