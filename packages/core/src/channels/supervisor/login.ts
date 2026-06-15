import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { updateChannelConfig } from "./config.ts"
import { resolveBridgeEntry } from "./resolve-bridge.ts"
import type { ChannelId } from "./types.ts"

async function promptLine(label: string) {
  const rl = readline.createInterface({ input, output })
  try {
    return (await rl.question(label)).trim()
  } finally {
    rl.close()
  }
}

async function spawnBridgeLogin(projectDir: string, channelId: "weixin", searchDirs: string[]) {
  const entry = resolveBridgeEntry(channelId, searchDirs)
  const env = {
    ...process.env,
    GATEHOUSE_PROJECT_DIR: projectDir,
  }
  const proc = Bun.spawn(["bun", entry, "login"], {
    env,
    cwd: projectDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`WeChat login failed (exit ${code})`)
}

export async function runChannelLogin(
  projectDir: string,
  channelId: ChannelId,
  searchDirs: string[],
) {
  if (channelId === "weixin") {
    await spawnBridgeLogin(projectDir, "weixin", searchDirs)
    updateChannelConfig(projectDir, "weixin", { enabled: true })
    console.log("Enabled channels.weixin")
    return
  }

  if (channelId === "feishu") {
    console.log("Feishu Bot setup (enterprise app App ID / App Secret)")
    const appId = await promptLine("App ID: ")
    const appSecret = await promptLine("App Secret: ")
    if (!appId || !appSecret) throw new Error("App ID and App Secret are required")
    updateChannelConfig(projectDir, "feishu", { appId, appSecret })
    console.log("Saved Feishu credentials to .gatehouse/channels.yaml")
    console.log("Tip: run bunx @gatehouse/core channels serve, then configure event subscription long connection in Feishu console.")
    return
  }

  if (channelId === "qq-onebot") {
    console.log("QQ group OneBot setup (NapCat forward WebSocket)")
    const wsUrl = (await promptLine("WebSocket URL [ws://127.0.0.1:3001]: ")) || "ws://127.0.0.1:3001"
    const accessToken = await promptLine("Access Token (optional, press Enter to skip): ")
    const requireAtAnswer = (await promptLine("Reply only when @mentioned? [Y/n]: ")).toLowerCase()
    const requireAt = requireAtAnswer !== "n" && requireAtAnswer !== "no"
    const allowListRaw = await promptLine("Group allowlist (comma-separated, empty for all groups): ")
    const groupAllowList = allowListRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    updateChannelConfig(projectDir, "qq-onebot", { wsUrl, accessToken, requireAt, groupAllowList })
    console.log("Saved QQ OneBot config to .gatehouse/channels.yaml")
    console.log("Tip: ensure NapCat is logged in with forward WebSocket enabled, then run channels serve.")
    return
  }

  if (channelId === "qq") {
    console.log("QQ official Bot setup")
    const appId = await promptLine("App ID: ")
    const secret = await promptLine("Client Secret: ")
    if (!appId || !secret) throw new Error("App ID and Client Secret are required")
    const sandboxAnswer = (await promptLine("Use sandbox environment? [Y/n]: ")).toLowerCase()
    const sandbox = sandboxAnswer !== "n" && sandboxAnswer !== "no"
    updateChannelConfig(projectDir, "qq", { appId, secret, sandbox })
    console.log("Saved QQ credentials to .gatehouse/channels.yaml")
  }
}
