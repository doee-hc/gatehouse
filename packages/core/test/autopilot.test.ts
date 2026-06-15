import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { lastConversationMessage } from "../src/lead/session-messages.ts"
import { deliveryAcceptanceHints } from "../src/delivery/store.ts"
import type { DeliveryRecord } from "../src/delivery/types.ts"
import { writeMissionsDocument } from "../src/missions/store.ts"
import { RegistryStore } from "../src/registry/store.ts"
import { checkAutopilotWatchdog, AUTOPILOT_WAKE_THRESHOLD_MS } from "../src/watchdog/autopilot.ts"
import { setAutopilotEnabled } from "../src/lead/autopilot.ts"
import { maybeDeliverAutopilotEnabledNotice } from "../src/lead/autopilot-notify.ts"
import {
  clearAutopilotWatchState,
  readAutopilotWatchState,
  writeAutopilotWatchState,
} from "../src/lead/autopilot-watch.ts"
import { directionPath } from "../src/lead/direction.ts"
import {
  handleAutopilotCommand,
  parseAutopilotCommand,
} from "../src/channels/registry/autopilot-command.ts"

async function tempProject(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
  return dir
}

async function writeConfirmedDirection(dir: string) {
  await writeFile(
    directionPath(dir),
    `schema_version: 1
status: confirmed
summary: test
constraints: []
confirmed_at: "2026-01-01T00:00:00.000Z"
confirmed_by: user
`,
  )
}

describe("autopilot", () => {
  test("lastConversationMessage picks latest user or assistant", () => {
    const last = lastConversationMessage([
      { info: { role: "user", id: "u1" } },
      { info: { role: "assistant", id: "a1" } },
    ] as Record<string, unknown>[])
    expect(last?.role).toBe("assistant")
    expect(last?.id).toBe("a1")
  })

  test("deliveryAcceptanceHints treats manual skipped as eligible when no unmet", () => {
    const record = {
      version: 1,
      status: "submitted",
      submitted_at: "t",
      submitted_by_node: "root",
      criteria: [
        { id: 0, text: "doc ok", check: { kind: "manual" as const } },
        { id: 1, text: "file", check: { kind: "path_exists" as const, path: "a.md" } },
      ],
      evidence: [],
      precheck: [
        { criterion_id: 0, status: "skipped", detail: "manual" },
        { criterion_id: 1, status: "met", detail: "file exists" },
      ],
    } satisfies DeliveryRecord
    const hints = deliveryAcceptanceHints(record)
    expect(hints.manual_criteria_count).toBe(1)
    expect(hints.auto_accept_eligible).toBe(true)
  })

  test("parseAutopilotCommand", () => {
    expect(parseAutopilotCommand("hello")).toBeUndefined()
    expect(parseAutopilotCommand("/autopilot")).toEqual({ kind: "status" })
    expect(parseAutopilotCommand("/autopilot on")).toEqual({ kind: "on" })
    expect(parseAutopilotCommand("/autopilot off")).toEqual({ kind: "off" })
  })

  test("handleAutopilotCommand toggles project state", async () => {
    const dir = await tempProject("gh-autopilot-cmd-")
    const on = await handleAutopilotCommand({ projectDirectory: dir, command: { kind: "on" } })
    expect(on.text).toContain("Autopilot enabled")
    const status = await handleAutopilotCommand({ projectDirectory: dir, command: { kind: "status" } })
    expect(status.text).toContain("ON")
    const off = await handleAutopilotCommand({ projectDirectory: dir, command: { kind: "off" } })
    expect(off.text).toContain("disabled")
    const toggledOn = await handleAutopilotCommand({ projectDirectory: dir, command: { kind: "toggle" } })
    expect(toggledOn.text).toContain("Autopilot enabled")
    const toggledOff = await handleAutopilotCommand({ projectDirectory: dir, command: { kind: "toggle" } })
    expect(toggledOff.text).toContain("disabled")
  })

  test("handleAutopilotCommand respects locale override", async () => {
    const dir = await tempProject("gh-autopilot-locale-")
    const enabled = await handleAutopilotCommand({
      projectDirectory: dir,
      command: { kind: "on" },
      locale: "en",
    })
    expect(enabled.text).toContain("Autopilot enabled")
    const disabled = await handleAutopilotCommand({
      projectDirectory: dir,
      command: { kind: "off" },
      locale: "en",
    })
    expect(disabled.text).toBe("Autopilot disabled.")
  })

  test("checkAutopilotWatchdog skips when autopilot off", async () => {
    const dir = await tempProject("gh-autopilot-off-")
    await writeConfirmedDirection(dir)
    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })
    const result = await checkAutopilotWatchdog({
      pluginInput: { directory: dir, client: {} } as never,
      registry: store,
      now: Date.now(),
    })
    expect(result.action).toBe("autopilot_off")
  })

  test("checkAutopilotWatchdog skips when mission is running", async () => {
    const dir = await tempProject("gh-autopilot-mission-")
    await writeConfirmedDirection(dir)
    await setAutopilotEnabled({ projectDirectory: dir, enabled: true, enabledBy: "test" })
    await writeAutopilotWatchState(dir, {
      awaiting_since: Date.now() - AUTOPILOT_WAKE_THRESHOLD_MS - 1_000,
      last_assistant_message_id: "a1",
    })
    await writeMissionsDocument(dir, {
      schema_version: 1,
      missions: [{ id: "m1", status: "running", done_when: [], must_not: [] }],
    })

    const mockClient = {
      session: {
        status: async () => ({ data: [] }),
        messages: async () => ({
          data: [{ info: { role: "assistant", id: "a1" } }],
        }),
      },
    }

    const store = await RegistryStore.create({ directory: dir, client: mockClient as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })

    const delivered: string[] = []
    store.deliverSystemMessage = async (_agent, content) => {
      delivered.push(content)
      return { status: "sent" as const }
    }

    const result = await checkAutopilotWatchdog({
      pluginInput: { directory: dir, client: mockClient } as never,
      registry: store,
      now: Date.now(),
    })

    expect(result.action).toBe("mission_active")
    expect(delivered.length).toBe(1)
    expect(delivered[0]).toContain("Autopilot")
  })

  test("checkAutopilotWatchdog wakes lead after threshold", async () => {
    const dir = await tempProject("gh-autopilot-wake-")
    await writeConfirmedDirection(dir)
    await setAutopilotEnabled({ projectDirectory: dir, enabled: true, enabledBy: "test" })
    await writeAutopilotWatchState(dir, {
      awaiting_since: Date.now() - AUTOPILOT_WAKE_THRESHOLD_MS - 1_000,
      last_assistant_message_id: "a1",
    })

    const mockClient = {
      session: {
        status: async () => ({ data: [] }),
        messages: async () => ({
          data: [{ info: { role: "assistant", id: "a1" } }],
        }),
        promptAsync: async () => {},
      },
    }

    const store = await RegistryStore.create({ directory: dir, client: mockClient as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })

    const delivered: string[] = []
    store.deliverSystemMessage = async (_agent, content) => {
      delivered.push(content)
      return { status: "sent" as const }
    }

    const result = await checkAutopilotWatchdog({
      pluginInput: { directory: dir, client: mockClient } as never,
      registry: store,
      now: Date.now(),
    })

    expect(result.action).toBe("wake")
    expect(delivered.length).toBe(2)
    expect(delivered[0]).toContain("Autopilot")
    expect(delivered[1]).toContain("do not ask")
  })

  test("maybeDeliverAutopilotEnabledNotice sends once when autopilot and direction ready", async () => {
    const dir = await tempProject("gh-autopilot-enabled-notify-")
    await writeConfirmedDirection(dir)
    await setAutopilotEnabled({ projectDirectory: dir, enabled: true, enabledBy: "test" })

    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })

    const delivered: string[] = []
    store.deliverSystemMessage = async (_agent, content) => {
      delivered.push(content)
      return { status: "sent" as const }
    }

    const first = await maybeDeliverAutopilotEnabledNotice({ projectDirectory: dir, registry: store })
    expect(first.action).toBe("notified")
    expect(delivered.length).toBe(1)
    expect(delivered[0]).toContain("Autopilot")

    const second = await maybeDeliverAutopilotEnabledNotice({ projectDirectory: dir, registry: store })
    expect(second.action).toBe("already_notified")
    expect(delivered.length).toBe(1)
  })

  test("clearAutopilotWatchState preserves enabled_notify_key", async () => {
    const dir = await tempProject("gh-autopilot-clear-preserve-")
    await writeAutopilotWatchState(dir, {
      awaiting_since: Date.now(),
      last_wake_at: Date.now(),
      last_assistant_message_id: "a1",
      enabled_notify_key: "2026-01-01T00:00:00.000Z|2026-01-02T00:00:00.000Z",
    })

    await clearAutopilotWatchState(dir)

    const state = await readAutopilotWatchState(dir)
    expect(state.enabled_notify_key).toBe("2026-01-01T00:00:00.000Z|2026-01-02T00:00:00.000Z")
    expect(state.awaiting_since).toBeUndefined()
    expect(state.last_wake_at).toBeUndefined()
    expect(state.last_assistant_message_id).toBeUndefined()
  })

  test("clearAutopilotWatchState does not resend autopilot enabled notice", async () => {
    const dir = await tempProject("gh-autopilot-clear-notify-")
    await writeConfirmedDirection(dir)
    await setAutopilotEnabled({ projectDirectory: dir, enabled: true, enabledBy: "test" })

    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })

    const delivered: string[] = []
    store.deliverSystemMessage = async (_agent, content) => {
      delivered.push(content)
      return { status: "sent" as const }
    }

    const first = await maybeDeliverAutopilotEnabledNotice({ projectDirectory: dir, registry: store })
    expect(first.action).toBe("notified")
    expect(delivered.length).toBe(1)

    await clearAutopilotWatchState(dir)

    const second = await maybeDeliverAutopilotEnabledNotice({ projectDirectory: dir, registry: store })
    expect(second.action).toBe("already_notified")
    expect(delivered.length).toBe(1)
  })

  test("checkAutopilotWatchdog notifies lead when direction confirmed after autopilot on", async () => {
    const dir = await tempProject("gh-autopilot-direction-confirm-")
    await setAutopilotEnabled({ projectDirectory: dir, enabled: true, enabledBy: "test" })
    await writeConfirmedDirection(dir)

    const mockClient = {
      session: {
        status: async () => ({ data: [] }),
        messages: async () => ({
          data: [{ info: { role: "user", id: "u1" } }],
        }),
      },
    }

    const store = await RegistryStore.create({ directory: dir, client: mockClient as never })
    store.registerOuterSession({
      profile: "lead",
      sessionId: "ses_lead",
      projectRootSessionId: "ses_lead",
    })

    const delivered: string[] = []
    store.deliverSystemMessage = async (_agent, content) => {
      delivered.push(content)
      return { status: "sent" as const }
    }

    const result = await checkAutopilotWatchdog({
      pluginInput: { directory: dir, client: mockClient } as never,
      registry: store,
      now: Date.now(),
    })

    expect(result.action).toBe("wait_assistant")
    expect(delivered.length).toBe(1)
    expect(delivered[0]).toContain("Autopilot")
  })
})
