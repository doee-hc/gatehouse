import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { readTuiNotificationsFromOffset, tuiNotificationFileEndOffset } from "./notifications.ts"

export function installTuiLogBridge(api: TuiPluginApi) {
  const directory = api.state.path.directory || process.cwd()
  // Do not replay notifications from previous dev sessions (stale toasts).
  let offset = tuiNotificationFileEndOffset(directory)
  const seen = new Set<string>()

  const poll = () => {
    const directory = api.state.path.directory || process.cwd()
    const { notifications, nextOffset } = readTuiNotificationsFromOffset(directory, offset)
    offset = nextOffset

    for (const notification of notifications) {
      if (seen.has(notification.id)) continue
      seen.add(notification.id)
      api.ui.toast({
        title: notification.title,
        message: notification.message,
        variant: notification.level === "error" ? "error" : "warning",
        duration: notification.level === "error" ? 10_000 : 8_000,
      })
    }
  }

  poll()
  const timer = setInterval(poll, 2000)
  api.lifecycle.onDispose(() => clearInterval(timer))
}
