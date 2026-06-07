import type { PortalDisplayConfig } from "../portal/poll-intervals.ts"
import { displayConfigUrl } from "./project-directory.ts"

export type { PortalDisplayConfig }

export async function loadPortalDisplayConfig(project: string) {
  const response = await fetch(displayConfigUrl(project), { signal: AbortSignal.timeout(5000) }).catch(
    () => undefined,
  )
  if (!response?.ok) return undefined
  return (await response.json()) as PortalDisplayConfig
}
