import { probePortalEndpoints, type PortalEndpoints } from "../../core/src/portal/ports.ts"

export type { PortalEndpoints }

export async function resolvePortalEndpoints(input: {
  projectDir: string
  displayApiEnv?: string
  adminApiEnv?: string
  displayPreferred?: string
  adminPreferred?: string
}) {
  return probePortalEndpoints(input.projectDir, {
    displayApiEnv: input.displayApiEnv,
    adminApiEnv: input.adminApiEnv,
    displayPreferred: input.displayPreferred ? Number(input.displayPreferred) : undefined,
    adminPreferred: input.adminPreferred ? Number(input.adminPreferred) : undefined,
  })
}
