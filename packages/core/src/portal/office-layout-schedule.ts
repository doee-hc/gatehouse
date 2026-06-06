import path from "node:path"
import { gatehouseLog } from "../log.ts"

const LAYOUT_SYNC_DEBOUNCE_MS = 1500

const layoutSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const layoutSyncInFlight = new Map<string, Promise<unknown>>()

/** Debounced office layout sync (bootstrap + portal snapshot when assets are stale). */
export function scheduleOfficeLayoutSync(projectDirectory: string, delayMs = LAYOUT_SYNC_DEBOUNCE_MS) {
  const key = path.resolve(projectDirectory)
  if (layoutSyncInFlight.has(key)) return
  if (layoutSyncTimers.has(key)) return
  layoutSyncTimers.set(
    key,
    setTimeout(() => {
      layoutSyncTimers.delete(key)
      const task = import("./office-layout-generate.ts")
        .then(({ syncOfficeLayout }) => syncOfficeLayout(projectDirectory))
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          gatehouseLog("warn", `[gatehouse/portal] office layout sync failed: ${message}`, {
            projectDirectory,
            title: "Portal",
          })
        })
      layoutSyncInFlight.set(key, task)
      void task.finally(() => layoutSyncInFlight.delete(key))
    }, delayMs),
  )
}

export function resetOfficeLayoutSyncScheduleForTests() {
  for (const timer of layoutSyncTimers.values()) clearTimeout(timer)
  layoutSyncTimers.clear()
  layoutSyncInFlight.clear()
}
