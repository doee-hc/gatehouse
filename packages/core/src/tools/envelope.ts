import { gatehouseToolMetadata, toolFail, toolOk } from "../channels/tool-envelope.ts"

const PLUGIN = "gatehouse.core"

export { toolFail, toolOk }

export function toolMetadata(tool: string) {
  return gatehouseToolMetadata(tool, PLUGIN, "ok")
}

export function toolErrorMetadata(tool: string) {
  return gatehouseToolMetadata(tool, PLUGIN, "error")
}
