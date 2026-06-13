import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { lastConversationMessage } from "../src/lead/session-messages.ts"
import { resolveLeadAwaitContext, leadAwaitContextMatchesState } from "../src/lead/await-phase.ts"
import { deliveryAcceptanceHints } from "../src/delivery/store.ts"
import type { DeliveryRecord } from "../src/delivery/types.ts"
import { writeMissionsDocument } from "../src/missions/store.ts"
import { RegistryStore } from "../src/registry/store.ts"
import { checkLeadUserAwaitWatchdog, LEAD_USER_AWAIT_THRESHOLD_MS } from "../src/watchdog/lead-user-await.ts"
import { writeLeadAwaitUserState } from "../src/lead/await-user-state.ts"
import { directionPath } from "../src/lead/direction.ts"
import { RegistryDatabase } from "../src/registry/db.ts"

async function tempProject(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await mkdir(path.join(dir, ".gatehouse", "lead"), { recursive: true })
  return dir
}

describe("lead user-await helpers", () => {
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

  test("resolveLeadAwaitContext returns null during running execution without delivery", async () => {
    const dir = await tempProject("gh-lead-await-")
    await writeMissionsDocument(dir, {
      schema_version: 3,
      missions: [{ id: "m1", status: "running", done_when: ["x"], must_not: [] }],
    })
    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    const ctx = await resolveLeadAwaitContext({ projectDirectory: dir, registry: store })
    expect(ctx).toBe(null)
  })

  test("resolveLeadAwaitContext returns acceptance when delivery submitted", async () => {
    const dir = await tempProject("gh-lead-await-")
    await writeMissionsDocument(dir, {
      schema_version: 3,
      missions: [{ id: "m1", status: "running", done_when: ["x"], must_not: [] }],
    })
    new RegistryDatabase(dir).saveDeliveryDocument({
      schema_version: 1,
      mission_id: "m1",
      active: {
        version: 1,
        status: "submitted",
        submitted_at: "2026-01-01T00:00:00.000Z",
        submitted_by_node: "root",
        criteria: [],
        evidence: [],
        precheck: [],
      },
      history: [],
    })

    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    const ctx = await resolveLeadAwaitContext({ projectDirectory: dir, registry: store })
    expect(ctx).toEqual({ phase: "acceptance", missionId: "m1", requiresArm: false })
  })

  test("resolveLeadAwaitContext returns pre_start only when armed", async () => {
    const dir = await tempProject("gh-lead-await-")
    await writeMissionsDocument(dir, {
      schema_version: 3,
      missions: [{ id: "m1", status: "queued", done_when: ["x"], must_not: [] }],
    })
    const store = await RegistryStore.create({ directory: dir, client: {} as never })
    expect(
      await resolveLeadAwaitContext({ projectDirectory: dir, registry: store }),
    ).toBe(null)
    expect(
      await resolveLeadAwaitContext({
        projectDirectory: dir,
        registry: store,
        armedPreStartMissionId: "m1",
      }),
    ).toEqual({ phase: "pre_start", missionId: "m1", requiresArm: true })
  })

  test("leadAwaitContextMatchesState requires arm for pre_start", () => {
    expect(
      leadAwaitContextMatchesState(
        { phase: "pre_start", missionId: "m1", requiresArm: true },
        { phase: "pre_start", mission_id: "m1" },
      ),
    ).toBe(false)
    expect(
      leadAwaitContextMatchesState(
        { phase: "pre_start", missionId: "m1", requiresArm: true },
        { phase: "pre_start", mission_id: "m1", armed: true },
      ),
    ).toBe(true)
  })

  test("checkLeadUserAwaitWatchdog wakes lead after threshold", async () => {
    const dir = await tempProject("gh-lead-await-")
    await mkdir(path.dirname(directionPath(dir)), { recursive: true })
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
    await writeMissionsDocument(dir, {
      schema_version: 3,
      missions: [{ id: "m1", status: "queued", done_when: ["x"], must_not: [], priority: "P1" }],
    })
    await writeLeadAwaitUserState(dir, {
      phase: "pre_start",
      mission_id: "m1",
      armed: true,
      awaiting_since: Date.now() - LEAD_USER_AWAIT_THRESHOLD_MS - 1_000,
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

    const pluginInput = {
      directory: dir,
      client: mockClient,
    }

    const result = await checkLeadUserAwaitWatchdog({
      pluginInput: pluginInput as never,
      registry: store,
      now: Date.now(),
    })

    expect(result.action).toBe("wake")
    expect(delivered.length).toBe(1)
    expect(delivered[0]).toContain("m1")
  })
})
