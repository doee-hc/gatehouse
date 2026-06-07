import { getPortalDisplaySettings } from "./portal-display-settings.ts"

let activeConnections = 0
let rejectedTotal = 0

function maxSseConnections() {
  return getPortalDisplaySettings().sseMax
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
