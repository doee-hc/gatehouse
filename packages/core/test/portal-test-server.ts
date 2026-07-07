import {
  setPortalInProcessDelivery,
  subscribePortalEvents,
} from "../src/portal/events.ts"
import { isPortListening } from "../src/portal/ports.ts"

type PortalInternalHandler = (request: Request) => Promise<Response> | Response

export type PortalInternalEventCapture = {
  server: { stop(): void }
  port: number
  mode: "http" | "in-process"
  get posted(): unknown
  waitPosted(timeoutMs?: number): Promise<void>
  begin(): void
  end(): void
}

async function waitForServerPort(server: ReturnType<typeof Bun.serve>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = server.port
    if (port && (await isPortListening(port))) return port
    await Bun.sleep(10)
  }
  throw new Error("ephemeral server port not ready")
}

async function localhostHttpReachable(port: number) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
    return true
  } catch {
    return false
  }
}

export async function startEphemeralServer(handler: PortalInternalHandler) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: handler,
  })
  const port = await waitForServerPort(server)
  return { server, port }
}

function createPostedWaiter() {
  let posted: unknown
  let resolvePosted!: () => void
  let postedPromise = new Promise<void>((resolve) => {
    resolvePosted = resolve
  })

  return {
    notePosted(value: unknown) {
      posted = value
      resolvePosted()
    },
    get posted() {
      return posted
    },
    waitPosted(timeoutMs = 5000) {
      return Promise.race([
        postedPromise,
        Bun.sleep(timeoutMs).then(() => {
          throw new Error("timed out waiting for portal internal event POST")
        }),
      ])
    },
  }
}

export async function startPortalInternalEventCapture(token: string): Promise<PortalInternalEventCapture> {
  const waiter = createPostedWaiter()
  const { server, port } = await startEphemeralServer(async (request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/portal/api/internal/event") {
      return new Response("not found", { status: 404 })
    }
    if (request.headers.get("X-Gatehouse-Portal-Internal-Token") !== token) {
      return new Response("unauthorized", { status: 401 })
    }
    waiter.notePosted(await request.json())
    return Response.json(waiter.posted)
  })

  if (await localhostHttpReachable(port)) {
    return {
      server,
      port,
      mode: "http",
      get posted() {
        return waiter.posted
      },
      waitPosted: waiter.waitPosted,
      begin() {},
      end() {},
    }
  }

  server.stop()

  let unsubscribe: (() => void) | undefined
  let active = false

  return {
    server: {
      stop() {
        if (active) {
          setPortalInProcessDelivery(false)
          active = false
        }
        unsubscribe?.()
        unsubscribe = undefined
      },
    },
    port: 0,
    mode: "in-process",
    get posted() {
      return waiter.posted
    },
    waitPosted: waiter.waitPosted,
    begin() {
      if (active) return
      unsubscribe = subscribePortalEvents((event) => waiter.notePosted(event))
      setPortalInProcessDelivery(true)
      active = true
    },
    end() {
      if (!active) return
      setPortalInProcessDelivery(false)
      active = false
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}

export async function withPortalEnv<T>(
  target: number | PortalInternalEventCapture,
  token: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const capture = typeof target === "number" ? undefined : target
  const port = typeof target === "number" ? target : target.port
  const api = port ? `http://127.0.0.1:${port}` : "http://127.0.0.1:0"
  const prevPort = process.env.GATEHOUSE_PORTAL_PORT
  const prevApi = process.env.GATEHOUSE_PORTAL_API
  const prevToken = process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
  process.env.GATEHOUSE_PORTAL_PORT = String(port)
  process.env.GATEHOUSE_PORTAL_API = api
  process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = token
  capture?.begin()
  try {
    return await fn()
  } finally {
    capture?.end()
    if (prevPort === undefined) delete process.env.GATEHOUSE_PORTAL_PORT
    else process.env.GATEHOUSE_PORTAL_PORT = prevPort
    if (prevApi === undefined) delete process.env.GATEHOUSE_PORTAL_API
    else process.env.GATEHOUSE_PORTAL_API = prevApi
    if (prevToken === undefined) delete process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
    else process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = prevToken
  }
}
