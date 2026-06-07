export type AdaptivePollOptions = {
  intervalMs: number
  hiddenIntervalMs?: number
  run: () => void | Promise<void>
}

function pollIntervalMs(intervalMs: number, hiddenIntervalMs?: number) {
  if (!document.hidden) return intervalMs
  return hiddenIntervalMs ?? intervalMs * 3
}

export function startAdaptivePolling(options: AdaptivePollOptions) {
  let timer: ReturnType<typeof setInterval> | undefined

  const reschedule = () => {
    if (timer) clearInterval(timer)
    timer = setInterval(() => void options.run(), pollIntervalMs(options.intervalMs, options.hiddenIntervalMs))
  }

  const onVisibility = () => reschedule()
  document.addEventListener("visibilitychange", onVisibility)
  void options.run()
  reschedule()

  return () => {
    document.removeEventListener("visibilitychange", onVisibility)
    if (timer) clearInterval(timer)
    timer = undefined
  }
}
