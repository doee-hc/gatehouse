import path from "node:path"
import { loadDotEnv } from "@gatehouse/core/channels"
import { runBridge } from "./bridge.ts"
import { loadConfig } from "./config.ts"
import { loginWithQr } from "./ilink/auth.ts"

async function main() {
  await loadDotEnv([
    path.join(import.meta.dir, "..", ".env"),
    path.join(process.cwd(), ".env"),
  ])
  const config = loadConfig()
  const command = process.argv[2]?.trim()

  if (command === "login") {
    await loginWithQr({
      ilinkBaseUrl: config.ilinkBaseUrl,
      botType: config.botType,
      stateDir: config.stateDir,
      projectDir: config.projectDir,
    })
    return
  }

  await runBridge(config)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
