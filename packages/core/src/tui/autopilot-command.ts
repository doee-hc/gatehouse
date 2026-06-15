import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { handleAutopilotCommand } from "../channels/registry/autopilot-command.ts"

async function toggleAutopilot(api: TuiPluginApi) {
  const projectDirectory = api.state.path.directory || process.cwd()
  try {
    const { text } = await handleAutopilotCommand({
      projectDirectory,
      command: { kind: "toggle" },
      enabledBy: "tui",
      locale: "en",
      deliverLeadNotice: { client: api.client as never },
    })
    api.ui.toast({ title: "Autopilot", message: text, duration: 8000 })
  } catch (error) {
    api.ui.toast({
      variant: "error",
      message: error instanceof Error ? error.message : String(error),
      duration: 10_000,
    })
  }
}

export function installAutopilotTuiCommands(api: TuiPluginApi) {
  const register = api.command?.register
  if (!register) return

  return register(() => [
    {
      title: "Autopilot",
      value: "gatehouse.autopilot",
      description: "Toggle Gatehouse autopilot",
      category: "Gatehouse",
      suggested: true,
      slash: { name: "autopilot" },
      onSelect: (dialog) => {
        dialog?.clear()
        void toggleAutopilot(api)
      },
    },
  ])
}
