import type { OrchestrationState } from "../types.ts"

export function orchestrationSandboxHealthy(state: OrchestrationState | undefined, sandboxRunning: boolean) {
  if (!sandboxRunning) return false
  return state?.sandbox?.status === "running" && !state.sandbox.last_error
}

export function orchestrationScriptUnchanged(
  state: OrchestrationState | undefined,
  scriptHash: string,
  planVersion: string,
) {
  return state?.sandbox?.script_hash === scriptHash && state?.sandbox?.plan_version === planVersion
}
