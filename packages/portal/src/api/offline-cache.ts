import { fetchOfflineDiskBundle } from "../portal/disk-cache-fetch.ts"

export async function loadOfflineDiskBundle(project?: string) {
  return fetchOfflineDiskBundle(project)
}
