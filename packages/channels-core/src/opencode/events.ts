function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function drainSseMessages(buffer: string) {
  const messages: unknown[] = []
  let rest = buffer
  while (true) {
    const index = rest.indexOf("\n\n")
    if (index === -1) break
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    if (!data) continue
    try {
      messages.push(JSON.parse(data) as unknown)
    } catch {
      // ignore malformed chunks
    }
  }
  return { messages, rest }
}

export function readSessionStatusIdleEvent(event: unknown) {
  if (!isRecord(event) || event.type !== "session.status") return undefined
  const properties = isRecord(event.properties) ? event.properties : undefined
  const sessionId = typeof properties?.sessionID === "string" ? properties.sessionID : undefined
  if (!sessionId) return undefined
  const status = properties?.status
  const type =
    typeof status === "string"
      ? status
      : isRecord(status) && typeof status.type === "string"
        ? status.type
        : undefined
  if (type !== "idle") return undefined
  return { sessionId }
}

export async function runOpencodeEventLoop(input: {
  opencodeUrl: string
  projectDir: string
  onEvent: (event: unknown) => void | Promise<void>
  signal?: AbortSignal
}) {
  const url = new URL("/event", input.opencodeUrl)
  url.searchParams.set("directory", input.projectDir)

  while (!input.signal?.aborted) {
    const upstream = await fetch(url, {
      headers: { "x-opencode-directory": input.projectDir },
      signal: input.signal,
    }).catch(() => undefined)

    if (!upstream?.ok || !upstream.body) {
      await Bun.sleep(2000)
      continue
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    try {
      while (!input.signal?.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        const parsed = drainSseMessages(pending)
        pending = parsed.rest
        for (const message of parsed.messages) {
          await input.onEvent(message)
        }
      }
    } catch {
      // upstream closed or aborted
    } finally {
      reader.releaseLock()
    }

    if (input.signal?.aborted) break
    await Bun.sleep(500)
  }
}
