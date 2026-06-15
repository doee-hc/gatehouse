import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { installGatehouseClientGuard } from "./client-guard.ts"
import { installTuiLogBridge } from "./log-bridge.ts"
import { installAutopilotTuiCommands } from "./autopilot-command.ts"
import { gatehouseSidebarSlot } from "./sidebar.tsx"

const tui: TuiPlugin = async (api) => {
  installGatehouseClientGuard(api)
  installTuiLogBridge(api)
  installAutopilotTuiCommands(api)
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content: gatehouseSidebarSlot(api),
    },
  })
}

export default {
  id: "gatehouse.tui",
  tui,
}
