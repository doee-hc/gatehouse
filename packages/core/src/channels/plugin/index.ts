import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { channelsSendFileTool } from "./send-file.ts"

export default {
  id: "gatehouse.channels",
  server: async (input: PluginInput): Promise<Hooks> => ({
    tool: {
      gatehouse_channels_send_file: channelsSendFileTool(input),
    },
  }),
}
