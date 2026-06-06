import { localeTag } from "./i18n.ts"

type EventEntry = {
  at: Date
  cls: string
  render: () => string
}

const entries: EventEntry[] = []

export function logEvent(render: () => string, cls = "") {
  const entry: EventEntry = { at: new Date(), cls, render }
  entries.unshift(entry)
  clearEventLogPlaceholder()
  paintEntry(entry)
  updateClock(entry.at)
}

export function refreshEventLog() {
  const log = document.getElementById("event-log")
  if (!log || log.querySelector(".empty-state")) return
  log.innerHTML = ""
  for (const entry of [...entries].reverse()) paintEntry(entry, log)
  if (entries.length > 0) updateClock(entries[0]!.at)
}

export function clearEventLogPlaceholder() {
  const log = document.getElementById("event-log")
  if (!log?.querySelector(".empty-state")) return
  log.innerHTML = ""
}

function paintEntry(entry: EventEntry, log?: HTMLElement) {
  const target = log ?? document.getElementById("event-log")
  if (!target) return
  const time = formatTime(entry.at)
  const div = document.createElement("div")
  div.innerHTML = `<span class="${entry.cls}">${time}</span> ${entry.render()}`
  target.insertBefore(div, target.firstChild)
}

function formatTime(at: Date) {
  return at.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })
}

function updateClock(at: Date) {
  const clock = document.getElementById("esc-time")
  if (clock) clock.textContent = formatTime(at)
}
