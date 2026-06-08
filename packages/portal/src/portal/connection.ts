let backendConnected = true

export function isBackendConnected() {
  return backendConnected
}

export function setBackendConnected(connected: boolean) {
  backendConnected = connected
}
