import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import {
  buildBridgeEnv,
  initChannelsConfig,
  isChannelConfigured,
  loadChannelsConfig,
  saveChannelsConfig,
  updateChannelConfig,
  validateChannelReady,
  weixinCredentialsPath,
} from "../src/supervisor/config.ts"
import { resolveBridgeEntry } from "../src/supervisor/resolve-bridge.ts"
import { writeJsonFile } from "../src/store/files.ts"

const tmpRoots: string[] = []

function makeProject() {
  const dir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-supervisor-"))
  tmpRoots.push(dir)
  fs.mkdirSync(path.join(dir, ".gatehouse"), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("channels supervisor config", () => {
  test("init creates default channels.yaml", () => {
    const dir = makeProject()
    const result = initChannelsConfig(dir)
    expect(result.created).toBe(true)
    const config = loadChannelsConfig(dir)
    expect(config.opencodeUrl).toBe("http://127.0.0.1:4096")
    expect(config.channels.feishu.enabled).toBe(false)
  })

  test("updateChannelConfig enables channel and stores secrets", () => {
    const dir = makeProject()
    initChannelsConfig(dir)
    updateChannelConfig(dir, "feishu", { appId: "cli_x", appSecret: "sec_y" })
    const config = loadChannelsConfig(dir)
    expect(config.channels.feishu.enabled).toBe(true)
    expect(config.channels.feishu.appId).toBe("cli_x")
    expect(isChannelConfigured(dir, "feishu", config)).toBe(true)
  })

  test("validate weixin requires credentials file", () => {
    const dir = makeProject()
    initChannelsConfig(dir)
    saveChannelsConfig(dir, {
      ...loadChannelsConfig(dir),
      channels: {
        ...loadChannelsConfig(dir).channels,
        weixin: { enabled: true },
      },
    })
    const config = loadChannelsConfig(dir)
    expect(validateChannelReady(dir, "weixin", config).ok).toBe(false)
    writeJsonFile(weixinCredentialsPath(dir), { botToken: "t", accountId: "a", baseUrl: "b", loggedInAt: 1 })
    expect(validateChannelReady(dir, "weixin", config).ok).toBe(true)
  })

  test("buildBridgeEnv maps qq sandbox flag", () => {
    const dir = makeProject()
    initChannelsConfig(dir)
    updateChannelConfig(dir, "qq", { appId: "1", secret: "2", sandbox: false })
    const config = loadChannelsConfig(dir)
    const env = buildBridgeEnv(dir, config, "qq")
    expect(env.QQ_SANDBOX).toBe("false")
    expect(env.GATEHOUSE_PROJECT_DIR).toBe(dir)
  })
})

describe("resolveBridgeEntry", () => {
  test("finds monorepo bridge scripts", () => {
    const entry = resolveBridgeEntry("weixin", [path.resolve(import.meta.dir, "../../..")])
    expect(entry.endsWith("packages/weixin-bridge/src/index.ts")).toBe(true)
  })

  test("finds bridges bundled in @gatehouse/core", () => {
    // Outside the monorepo so monorepo bridge discovery does not take precedence.
    const projectDir = fs.mkdtempSync(path.join("/tmp", "gatehouse-bridge-resolve-"))
    tmpRoots.push(projectDir)
    fs.mkdirSync(path.join(projectDir, ".gatehouse"), { recursive: true })
    const coreRoot = path.join(projectDir, "fake-core")
    const bridgeEntry = path.join(coreRoot, "bridges", "feishu-bridge", "src", "index.ts")
    fs.mkdirSync(path.dirname(bridgeEntry), { recursive: true })
    fs.writeFileSync(bridgeEntry, "export {}\n")
    fs.writeFileSync(path.join(coreRoot, "package.json"), JSON.stringify({ name: "@gatehouse/core" }))
    fs.writeFileSync(path.join(projectDir, ".gatehouse", "core.path"), `${coreRoot}\n`)

    const entry = resolveBridgeEntry("feishu", [projectDir])
    expect(entry).toBe(bridgeEntry)
  })
})
