#!/usr/bin/env bun
import path from "node:path"
import { notifyPortalPortInUse, PortalPortInUseError } from "../src/portal/ports.ts"
import { ensurePortalServer, stopPortalServer } from "../src/portal/server.ts"

const coreRoot = path.resolve(import.meta.dir, "..")
const projectDirectory = process.env.GATEHOUSE_PROJECT_DIR ?? process.cwd()

try {
  const server = await ensurePortalServer(path.resolve(projectDirectory), coreRoot)
  if (!server) {
    console.error("[gatehouse/portal] API failed to start")
    process.exit(1)
  }
} catch (error) {
  if (error instanceof PortalPortInUseError) {
    notifyPortalPortInUse(path.resolve(projectDirectory), error)
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

function shutdown() {
  stopPortalServer()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

await Bun.sleep(Number.POSITIVE_INFINITY)
