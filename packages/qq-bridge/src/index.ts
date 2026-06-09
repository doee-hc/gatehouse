import path from "node:path"
import { loadDotEnv } from "@gatehouse/core/channels"
import { runBridge } from "./bridge.ts"
import { loadConfig } from "./config.ts"

async function main() {
  await loadDotEnv([
    path.join(import.meta.dir, "..", ".env"),
    path.join(process.cwd(), ".env"),
  ])
  await runBridge(loadConfig())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
