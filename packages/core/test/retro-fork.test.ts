import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionRetroTool } from "../src/tools/retro.ts"
import { submitOrchestrationTool } from "../src/tools/submit-orchestration.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { readExtractManifest, readRetroManifest } from "../src/tree/store.ts"
import { readMissionsDocument } from "../src/missions/store.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { missionEntryToRecord } from "../src/missions/contract.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { isRecord, parseYaml } from "../src/yaml.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_CURATOR_ID, OUTER_LEAD_ID } from "../src/registry/types.ts"
import { seedSubmittedDelivery } from "./seed-delivery.ts"
import { stopSandboxOrchestration } from "../src/orchestration/sandbox-runtime.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function stopTestOrchestration(...missionIds: string[]) {
  for (const missionId of missionIds) stopSandboxOrchestration(missionId)
}

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof missionRetroTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

function mockToolContext(directory: string, sessionID = "test-session", agent = "architect"): ToolContext {
  return {
    sessionID,
    messageID: "test-message",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {},
    ask() {
      throw new Error("ask not implemented in mock")
    },
  }
}

async function registerJiyiForTest(pluginInput: PluginInput, sessionId = "ses_curator") {
  const registry = await getRegistryStore(pluginInput)
  registry.register({
    agentId: OUTER_CURATOR_ID,
    scope: "outer",
    profile: "curator",
    sessionId,
    displayName: "Curator",
  })
}

async function registerLeadForTest(pluginInput: PluginInput, sessionId = "ses_lead") {
  const registry = await getRegistryStore(pluginInput)
  registry.register({
    agentId: OUTER_LEAD_ID,
    scope: "outer",
    profile: "lead",
    sessionId,
    displayName: "Lead",
  })
}

describe("retro_batch skill kickoffs", () => {
  test("sends domain-skill-extract to exec sessions after jiyi assigns skill_domain", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-batch-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const promptCalls: Array<{ sessionId: string; text: string; agent?: string }> = []
      const mockClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_${sessionCounter}` }
          },
          async update() {},
          async promptAsync(input: {
            path?: { id: string }
            body?: { agent?: string; parts?: { text?: string }[] }
          }) {
            promptCalls.push({
              sessionId: input.path?.id ?? "",
              text: input.body?.parts?.[0]?.text ?? "",
              agent: input.body?.agent,
            })
          },
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { time: { created: 0, updated: 1000 } } }
          },
          async status() {
            return { data: {} }
          },
          async todo() {
            return { data: [] }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      await registerJiyiForTest(pluginInput, "ses_curator")
      const bootstrap = submitOrchestrationTool(pluginInput)
      await bootstrap.execute({}, mockToolContext(dir, "architect"))

      const apply = applySkillDomainsTool(pluginInput)
      await apply.execute(
        { assignments: { "node-doc": "docs" } },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      promptCalls.length = 0

      await registerLeadForTest(pluginInput)
      await seedSubmittedDelivery(dir, "core-example-smoke-v1")
      const retro = missionRetroTool(pluginInput)
      const output = toolOutput(
        await retro.execute({}, mockToolContext(dir, "ses_lead", "lead")),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")

      expect(parsed.data.retro_sessions).toBe(1)

      const skillPrompts = promptCalls.filter((call) => call.text.includes("领域 skill 提炼"))
      expect(skillPrompts).toHaveLength(1)
      const extractDoc = await readExtractManifest(dir, "core-example-smoke-v1")
      expect(skillPrompts[0]?.sessionId).toBe(extractDoc?.nodes["node-doc"]?.extract_session_id)
      expect(skillPrompts[0]?.text).toContain("docs")
      expect(skillPrompts[0]?.text).toContain("node-doc")
      expect(skillPrompts[0]?.text).toContain("gatehouse_skill_extract_record")

      const retroPrompts = promptCalls.filter((call) => call.text.includes("复盘任务"))
      expect(retroPrompts).toHaveLength(1)
      const retroDoc = await readRetroManifest(dir, "core-example-smoke-v1")
      expect(retroPrompts[0]?.sessionId).toBe(retroDoc?.nodes["node-root"]?.retro_session_id)
    } finally {
      stopTestOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("creates solo root retro session and skill kickoff in parallel", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-batch-solo-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "solo-root-mission"
      const treeDir = path.join(dir, ".gatehouse/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "mission.script.ts"),
        `export const team = {
  mission_id: "${missionId}",
  root: "node-root",
  nodes: {
    "node-root": {
      parent: null,
      description: "任务协调者兼执行者",
    },
  },
}

export default async function orchestrate(ctx) {
  await ctx.run("node-root", {
    brief: {
      role: "任务协调者兼执行者",
      your_work: ["执行并汇总交付"],
      acceptance_slice: ["交付已提交"],
    },
    text: "执行",
  })
}
`,
      )
      await Bun.write(
        path.join(dir, ".gatehouse/lead/missions.yaml"),
        Bun.YAML.stringify({
          schema_version: 1,
          missions: [
            {
              id: missionId,
              status: "running",
              objective: "solo root smoke",
              done_when: [],
              must_not: [],
            },
          ],
        }),
      )
      const lockedAt = new Date().toISOString()
      new RegistryDatabase(dir).activateMission(
        missionEntryToRecord(
          {
            id: missionId,
            status: "running",
            objective: "solo root smoke",
            done_when: ["done"],
            must_not: ["none"],
            started_at: lockedAt,
          },
          { lockedAt, isActive: true, status: "running" },
        ),
      )

      let sessionCounter = 0
      const promptCalls: Array<{ sessionId: string; text: string }> = []
      const mockClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_${sessionCounter}` }
          },
          async update() {},
          async promptAsync(input: { path?: { id: string }; body?: { parts?: { text?: string }[] } }) {
            promptCalls.push({
              sessionId: input.path?.id ?? "",
              text: input.body?.parts?.[0]?.text ?? "",
            })
          },
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { time: { created: 0, updated: 1000 } } }
          },
          async status() {
            return { data: {} }
          },
          async todo() {
            return { data: [] }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      await registerJiyiForTest(pluginInput, "ses_curator")
      await submitOrchestrationTool(pluginInput).execute({}, mockToolContext(dir, "architect"))
      await applySkillDomainsTool(pluginInput).execute(
        { assignments: { "node-root": "docs" } },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      promptCalls.length = 0

      await registerLeadForTest(pluginInput)
      await seedSubmittedDelivery(dir, missionId)
      const output = toolOutput(
        await missionRetroTool(pluginInput).execute(
          {},
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")

      expect(parsed.data.retro_sessions).toBe(1)

      const skillPrompts = promptCalls.filter((call) => call.text.includes("领域 skill 提炼"))
      expect(skillPrompts).toHaveLength(1)
      const extractSolo = await readExtractManifest(dir, missionId)
      expect(skillPrompts[0]?.sessionId).toBe(extractSolo?.nodes["node-root"]?.extract_session_id)

      const retroPrompts = promptCalls.filter((call) => call.text.includes("复盘任务"))
      expect(retroPrompts).toHaveLength(1)
      const retroSolo = await readRetroManifest(dir, missionId)
      expect(retroPrompts[0]?.sessionId).toBe(retroSolo?.nodes["node-root"]?.retro_session_id)
      expect(retroPrompts[0]?.text).toContain("node-root")
    } finally {
      stopTestOrchestration("solo-root-mission")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("skips skill kickoff when manifest has no skill_domain", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-batch-empty-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const mockClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_${sessionCounter}` }
          },
          async update() {},
          async promptAsync() {},
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { time: { created: 0, updated: 1000 } } }
          },
          async status() {
            return { data: {} }
          },
          async todo() {
            return { data: [] }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      await registerJiyiForTest(pluginInput, "ses_curator")
      await submitOrchestrationTool(pluginInput).execute(
        {},
        mockToolContext(dir, "architect"),
      )
      await applySkillDomainsTool(pluginInput).execute(
        { assignments: {} },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      await registerLeadForTest(pluginInput)
      await seedSubmittedDelivery(dir, "core-example-smoke-v1")
      const output = toolOutput(
        await missionRetroTool(pluginInput).execute(
          {},
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")
      expect(parsed.data.retro_sessions).toBe(1)
    } finally {
      stopTestOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("second mission_retro call is idempotent when retro already started", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-idempotent-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      let sessionCounter = 0
      const promptCalls: Array<{ sessionId: string; text: string }> = []
      const mockClient = {
        session: {
          async create() {
            sessionCounter += 1
            return { id: `ses_${sessionCounter}` }
          },
          async update() {},
          async promptAsync(input: { path?: { id: string }; body?: { parts?: { text?: string }[] } }) {
            promptCalls.push({
              sessionId: input.path?.id ?? "",
              text: input.body?.parts?.[0]?.text ?? "",
            })
          },
          async messages() {
            return { data: [] }
          },
          async get() {
            return { data: { time: { created: 0, updated: 1000 } } }
          },
          async status() {
            return { data: {} }
          },
          async todo() {
            return { data: [] }
          },
        },
      }

      const pluginInput = { directory: dir, client: mockClient } as unknown as PluginInput
      await registerJiyiForTest(pluginInput, "ses_curator")
      await submitOrchestrationTool(pluginInput).execute({}, mockToolContext(dir, "architect"))
      await applySkillDomainsTool(pluginInput).execute(
        { assignments: {} },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      await registerLeadForTest(pluginInput)
      await seedSubmittedDelivery(dir, "core-example-smoke-v1")

      const retro = missionRetroTool(pluginInput)
      const leadCtx = mockToolContext(dir, "ses_lead", "lead")

      const firstOutput = toolOutput(await retro.execute({}, leadCtx))
      const firstParsed = parseYaml(firstOutput)
      if (!isRecord(firstParsed) || !isRecord(firstParsed.data)) throw new Error("unexpected first tool output")
      expect(firstParsed.ok).toBe(true)
      expect(firstParsed.data.already_started).toBeUndefined()

      const sessionsAfterFirst = sessionCounter
      const promptsAfterFirst = promptCalls.length
      const retroAfterFirst = await readRetroManifest(dir, "core-example-smoke-v1")

      const secondOutput = toolOutput(await retro.execute({}, leadCtx))
      const secondParsed = parseYaml(secondOutput)
      if (!isRecord(secondParsed) || !isRecord(secondParsed.data)) throw new Error("unexpected second tool output")
      expect(secondParsed.ok).toBe(true)
      expect(secondParsed.data.already_started).toBe(true)
      expect(sessionCounter).toBe(sessionsAfterFirst)
      expect(promptCalls.length).toBe(promptsAfterFirst)

      const missions = await readMissionsDocument(dir)
      const mission = missions.missions.find((entry) => entry.id === "core-example-smoke-v1")
      expect(mission?.status).toBe("retro")

      const retroAfterSecond = await readRetroManifest(dir, "core-example-smoke-v1")
      expect(retroAfterSecond?.nodes["node-root"]?.retro_session_id).toBe(
        retroAfterFirst?.nodes["node-root"]?.retro_session_id,
      )
    } finally {
      stopTestOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })
})
