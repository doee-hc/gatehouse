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
  if (code !== 0) throw new Error(`微信登录失败 (exit ${code})`)
}

export async function runChannelLogin(
  projectDir: string,
  channelId: ChannelId,
  searchDirs: string[],
) {
  if (channelId === "weixin") {
    await spawnBridgeLogin(projectDir, "weixin", searchDirs)
    updateChannelConfig(projectDir, "weixin", { enabled: true })
    console.log("已启用 channels.weixin")
    return
  }

  if (channelId === "feishu") {
    console.log("飞书 Bot 配置（企业自建应用 App ID / App Secret）")
    const appId = await promptLine("App ID: ")
    const appSecret = await promptLine("App Secret: ")
    if (!appId || !appSecret) throw new Error("App ID 与 App Secret 不能为空")
    updateChannelConfig(projectDir, "feishu", { appId, appSecret })
    console.log("已保存飞书凭证到 .gatehouse/channels.yaml")
    console.log("提示: 先运行 bunx @gatehouse/core channels serve，再在飞书控制台配置事件订阅长连接。")
    return
  }

  console.log("QQ 官方 Bot 配置")
  const appId = await promptLine("App ID: ")
  const secret = await promptLine("Client Secret: ")
  if (!appId || !secret) throw new Error("App ID 与 Client Secret 不能为空")
  const sandboxAnswer = (await promptLine("使用沙箱环境? [Y/n]: ")).toLowerCase()
  const sandbox = sandboxAnswer !== "n" && sandboxAnswer !== "no"
  updateChannelConfig(projectDir, "qq", { appId, secret, sandbox })
  console.log("已保存 QQ 凭证到 .gatehouse/channels.yaml")
}
