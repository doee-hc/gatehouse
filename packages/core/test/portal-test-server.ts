type PortalInternalHandler = (request: Request) => Promise<Response> | Response

export function startEphemeralServer(handler: PortalInternalHandler) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: handler,
  })
  return server
}

export function startPortalInternalEventCapture(token: string) {
  let posted: unknown
  let resolvePosted!: () => void
  const postedPromise = new Promise<void>((resolve) => {
    resolvePosted = resolve
  })
  const server = startEphemeralServer(async (request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/portal/api/internal/event") {
      return new Response("not found", { status: 404 })
    }
    if (request.headers.get("X-Gatehouse-Portal-Internal-Token") !== token) {
      return new Response("unauthorized", { status: 401 })
    }
    posted = await request.json()
    resolvePosted()
    return Response.json(posted)
  })
  return {
    server,
    port: server.port!,
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

export async function withPortalEnv<T>(
  port: number,
  token: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prevPort = process.env.GATEHOUSE_PORTAL_PORT
  const prevToken = process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
  process.env.GATEHOUSE_PORTAL_PORT = String(port)
  process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = token
  try {
    return await fn()
  } finally {
    if (prevPort === undefined) delete process.env.GATEHOUSE_PORTAL_PORT
    else process.env.GATEHOUSE_PORTAL_PORT = prevPort
    if (prevToken === undefined) delete process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN
    else process.env.GATEHOUSE_PORTAL_INTERNAL_TOKEN = prevToken
  }
}
