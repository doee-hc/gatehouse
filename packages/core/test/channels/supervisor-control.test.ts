import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  consumeSupervisorControl,
  enqueueSupervisorControl,
  resolveGatehouseCliEntry,
  supervisorControlPath,
} from "../../src/channels/supervisor/index.ts"

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatehouse-control-"))
  fs.mkdirSync(path.join(dir, ".gatehouse"), { recursive: true })
  return dir
}

describe("supervisor control", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  test("enqueue and consume control command", () => {
    const projectDir = tempProject()
    dirs.push(projectDir)
    enqueueSupervisorControl(projectDir, "stop_channel", "weixin")
    const command = consumeSupervisorControl(projectDir)
    expect(command?.action).toBe("stop_channel")
    expect(command?.channelId).toBe("weixin")
    expect(fs.existsSync(supervisorControlPath(projectDir))).toBe(false)
  })

  test("resolveGatehouseCliEntry prefers live fallback over core.path", () => {
    const projectDir = tempProject()
    dirs.push(projectDir)
    fs.mkdirSync(path.join(projectDir, ".gatehouse"), { recursive: true })
    fs.writeFileSync(path.join(projectDir, ".gatehouse/core.path"), "/tmp/stale-pack\n")
    const fallback = path.resolve(import.meta.dir, "../..")
    const cli = resolveGatehouseCliEntry(projectDir, fallback)
    expect(cli).toBe(path.join(fallback, "bin", "gatehouse.ts"))
  })

})
