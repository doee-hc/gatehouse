import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { gatehouseLog } from "../src/log.ts"
import {
  readTuiNotificationsFromOffset,
  tuiNotificationFileEndOffset,
} from "../src/tui/notifications.ts"

describe("gatehouseLog", () => {
  let projectDir = ""
  const previousLogMode = process.env.GATEHOUSE_LOG

  afterEach(async () => {
    if (previousLogMode === undefined) delete process.env.GATEHOUSE_LOG
    else process.env.GATEHOUSE_LOG = previousLogMode
    if (projectDir) await rm(projectDir, { recursive: true, force: true })
    projectDir = ""
  })

  test("default file mode writes to gatehouse.log without console or tui", async () => {
    delete process.env.GATEHOUSE_LOG
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    const infoLines: string[] = []
    const warnLines: string[] = []
    const originalLog = console.log
    const originalWarn = console.warn
    console.log = (...args: unknown[]) => {
      infoLines.push(args.map(String).join(" "))
    }
    console.warn = (...args: unknown[]) => {
      warnLines.push(args.map(String).join(" "))
    }

    try {
      gatehouseLog("info", "[gatehouse/portal] UI http://127.0.0.1:8787/", {
        projectDirectory: projectDir,
        title: "Portal",
      })
      gatehouseLog("warn", "[gatehouse/portal] snapshot failed: boom", {
        projectDirectory: projectDir,
        title: "Portal",
      })
    } finally {
      console.log = originalLog
      console.warn = originalWarn
    }

    expect(infoLines).toHaveLength(0)
    expect(warnLines).toHaveLength(0)

    const logFile = path.join(projectDir, ".gatehouse", "logs", "gatehouse.log")
    expect(existsSync(logFile)).toBe(true)
    const text = readFileSync(logFile, "utf8")
    expect(text).toContain("[info] [gatehouse/portal] UI")
    expect(text).toContain("[warn] [gatehouse/portal] snapshot failed")

    const notifyFile = path.join(projectDir, ".gatehouse", "tui-notifications.jsonl")
    expect(existsSync(notifyFile)).toBe(false)
  })

  test("tui flag routes warn/error to notifications", async () => {
    delete process.env.GATEHOUSE_LOG
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    gatehouseLog("warn", "[gatehouse/portal] snapshot failed: boom", {
      projectDirectory: projectDir,
      title: "Portal",
      tui: true,
    })

    const file = path.join(projectDir, ".gatehouse", "tui-notifications.jsonl")
    expect(existsSync(file)).toBe(true)
    const { notifications } = readTuiNotificationsFromOffset(projectDir)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.level).toBe("warn")
    expect(notifications[0]?.title).toBe("Portal")
    expect(notifications[0]?.message).toContain("snapshot failed")
  })

  test("verbose mode writes to console and log file", async () => {
    process.env.GATEHOUSE_LOG = "verbose"
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    const infoLines: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      infoLines.push(args.map(String).join(" "))
    }

    try {
      gatehouseLog("info", "hello portal", { projectDirectory: projectDir })
    } finally {
      console.log = originalLog
    }

    expect(infoLines).toEqual(["hello portal"])
    const logFile = path.join(projectDir, ".gatehouse", "logs", "gatehouse.log")
    expect(readFileSync(logFile, "utf8")).toContain("[info] hello portal")
  })

  test("quiet mode writes to log file without console", async () => {
    process.env.GATEHOUSE_LOG = "quiet"
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    const infoLines: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      infoLines.push(args.map(String).join(" "))
    }

    try {
      gatehouseLog("info", "quiet line", { projectDirectory: projectDir })
    } finally {
      console.log = originalLog
    }

    expect(infoLines).toHaveLength(0)
    const logFile = path.join(projectDir, ".gatehouse", "logs", "gatehouse.log")
    expect(readFileSync(logFile, "utf8")).toContain("[info] quiet line")
  })

  test("tuiNotificationFileEndOffset skips historical notifications", async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    gatehouseLog("error", "stale toast", { projectDirectory: projectDir, tui: true })
    const endOffset = tuiNotificationFileEndOffset(projectDir)

    gatehouseLog("error", "fresh toast", { projectDirectory: projectDir, tui: true })
    const { notifications } = readTuiNotificationsFromOffset(projectDir, endOffset)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.message).toBe("fresh toast")
  })

  test("readTuiNotificationsFromOffset returns only new lines", async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), "gh-log-"))
    await Bun.$`mkdir -p ${path.join(projectDir, ".gatehouse")}`.quiet()

    gatehouseLog("warn", "first", { projectDirectory: projectDir, tui: true })
    const first = readTuiNotificationsFromOffset(projectDir)
    expect(first.notifications).toHaveLength(1)

    gatehouseLog("error", "second", { projectDirectory: projectDir, tui: true })
    const second = readTuiNotificationsFromOffset(projectDir, first.nextOffset)
    expect(second.notifications).toHaveLength(1)
    expect(second.notifications[0]?.message).toBe("second")
  })
})
