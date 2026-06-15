import { readLocaleSync } from "../../locale.ts"
import {
  readAutopilotDocument,
  readAutopilotDocumentSync,
  setAutopilotEnabled,
  autopilotIsEnabled,
} from "../../lead/autopilot.ts"
import {
  readDirectionDocument,
  readDirectionDocumentSync,
  directionIsConfirmed,
} from "../../lead/direction.ts"
import { maybeDeliverAutopilotEnabledNotice } from "../../lead/autopilot-notify.ts"
import { RegistryStore } from "../../registry/store.ts"
import type { GatehouseClient } from "../../session/client.ts"

export type AutopilotCommand = { kind: "status" } | { kind: "on" } | { kind: "off" } | { kind: "toggle" }

export function parseAutopilotCommand(text: string): AutopilotCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/autopilot")) return undefined
  const rest = trimmed.slice("/autopilot".length).trim().toLowerCase()
  if (!rest || rest === "status") return { kind: "status" }
  if (rest === "on" || rest === "enable" || rest === "开启") return { kind: "on" }
  if (rest === "off" || rest === "disable" || rest === "关闭") return { kind: "off" }
  return undefined
}

function formatAutopilotStatus(projectDirectory: string, locale: "zh" | "en") {
  const autopilot = readAutopilotDocumentSync(projectDirectory)
  const direction = readDirectionDocumentSync(projectDirectory)
  const enabled = autopilotIsEnabled(autopilot)
  const directionOk = directionIsConfirmed(direction)

  if (locale === "zh") {
    const lines = [
      `Autopilot：${enabled ? "开启" : "关闭"}`,
      `长期方向：${directionOk ? "已确认" : "未确认（draft）"}`,
    ]
    if (enabled && !directionOk) {
      lines.push("看门狗在 direction 确认前不会唤醒 Lead。")
    } else if (enabled && directionOk) {
      lines.push("Lead 在你沉默 3 分钟后将收到全权负责提醒。")
    }
    lines.push("TUI：/autopilot 切换；IM：/autopilot on | off")
    return lines.join("\n")
  }

  const lines = [
    `Autopilot: ${enabled ? "ON" : "OFF"}`,
    `Direction: ${directionOk ? "confirmed" : "draft"}`,
  ]
  if (enabled && !directionOk) {
    lines.push("Watchdog will not wake lead until direction.yaml is confirmed.")
  } else if (enabled && directionOk) {
    lines.push("Lead gets a full-delegation reminder after 3 minutes without your reply.")
  }
  lines.push("TUI: /autopilot toggles; IM: /autopilot on | off")
  return lines.join("\n")
}

export async function handleAutopilotCommand(input: {
  projectDirectory: string
  command: AutopilotCommand
  enabledBy?: string
  locale?: "zh" | "en"
  /** When provided, delivers autopilot-enabled notice to lead immediately if direction is confirmed. */
  deliverLeadNotice?: { client: GatehouseClient }
}): Promise<{ text: string }> {
  const locale = input.locale ?? readLocaleSync(input.projectDirectory)
  if (input.command.kind === "status") {
    return { text: formatAutopilotStatus(input.projectDirectory, locale) }
  }

  const enabled =
    input.command.kind === "toggle"
      ? !autopilotIsEnabled(readAutopilotDocumentSync(input.projectDirectory))
      : input.command.kind === "on"
  await setAutopilotEnabled({
    projectDirectory: input.projectDirectory,
    enabled,
    enabledBy: input.enabledBy ?? "user",
  })

  if (enabled && input.deliverLeadNotice) {
    const registry = await RegistryStore.create({
      directory: input.projectDirectory,
      client: input.deliverLeadNotice.client,
    })
    await maybeDeliverAutopilotEnabledNotice({
      projectDirectory: input.projectDirectory,
      registry,
    })
  }

  if (locale === "zh") {
    if (enabled) {
      const direction = await readDirectionDocument(input.projectDirectory)
      const suffix = directionIsConfirmed(direction)
        ? "Lead 已收到（或将收到）全权负责系统提示；你沉默 3 分钟后看门狗将再次提醒。"
        : "请先确认 direction.yaml；确认后 Lead 将收到全权负责系统提示。"
      return { text: `Autopilot 已开启。${suffix}` }
    }
    return { text: "Autopilot 已关闭。" }
  }

  if (enabled) {
    const direction = await readDirectionDocument(input.projectDirectory)
    const suffix = directionIsConfirmed(direction)
      ? "Lead received (or will receive) a full-delegation system notice; watchdog reminds again after 3 minutes of silence."
      : "Confirm direction.yaml first; lead receives a full-delegation notice once confirmed."
    return { text: `Autopilot enabled. ${suffix}` }
  }
  return { text: "Autopilot disabled." }
}
