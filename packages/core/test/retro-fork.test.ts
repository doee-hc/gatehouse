import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { missionRetroTool } from "../src/tools/retro.ts"
import { bootstrapTreeTool } from "../src/tools/bootstrap.ts"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { missionEntryToRecord } from "../src/missions/contract.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { isRecord, parseYaml } from "../src/yaml.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_CURATOR_ID, OUTER_LEAD_ID } from "../src/registry/types.ts"

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

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

describe("retro_fork_batch skill kickoffs", () => {
  test("sends domain-skill-extract to exec sessions after jiyi assigns skill_domain", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-fork-"))
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
          async fork(input: { path?: { id: string } }) {
            sessionCounter += 1
            return { id: `ses_fork_${sessionCounter}`, parent: input.path?.id }
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
      const bootstrap = bootstrapTreeTool(pluginInput)
      await bootstrap.execute({}, mockToolContext(dir, "architect"))

      const apply = applySkillDomainsTool(pluginInput)
      await apply.execute(
        { assignments: JSON.stringify({ "node-doc": "docs" }) },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      promptCalls.length = 0

      await registerLeadForTest(pluginInput)
      const retro = missionRetroTool(pluginInput)
      const output = toolOutput(
        await retro.execute({}, mockToolContext(dir, "ses_lead", "lead")),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")

      const skillKickoffs = parsed.data.skill_kickoffs
      expect(Array.isArray(skillKickoffs)).toBe(true)
      expect(skillKickoffs).toHaveLength(1)
      if (!Array.isArray(skillKickoffs) || !isRecord(skillKickoffs[0])) throw new Error("bad skill_kickoffs")
      expect(skillKickoffs[0].nodeId).toBe("node-doc")
      expect(skillKickoffs[0].skillDomain).toBe("docs")
      expect(skillKickoffs[0].delivery).toBe("sent")

      const skillPrompts = promptCalls.filter((call) => call.text.includes("领域 skill 提炼"))
      expect(skillPrompts).toHaveLength(1)
      expect(skillPrompts[0]?.sessionId).toBe("ses_2")
      expect(skillPrompts[0]?.text).toContain("docs")
      expect(skillPrompts[0]?.text).toContain("node-doc")
      expect(skillPrompts[0]?.text).toContain("gatehouse_skill_extract_record")

      const retroPrompts = promptCalls.filter((call) => call.text.includes("复盘任务"))
      expect(retroPrompts).toHaveLength(1)
      expect(retroPrompts[0]?.sessionId.startsWith("ses_fork_")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("forks solo root retro session and skill kickoff in parallel", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-fork-solo-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      const missionId = "solo-root-mission"
      const treeDir = path.join(dir, ".gatehouse/trees", missionId)
      await mkdir(treeDir, { recursive: true })
      await Bun.write(
        path.join(treeDir, "teamspec.yaml"),
        `mission_id: ${missionId}
root: node-root
nodes:
  node-root:
    parent: null
    description: 任务协调者兼执行者
    constraints: |
      任务协调者兼执行者；交付后通知 lead。
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
          async fork(input: { path?: { id: string } }) {
            sessionCounter += 1
            return { id: `ses_fork_${sessionCounter}`, parent: input.path?.id }
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
      await bootstrapTreeTool(pluginInput).execute({}, mockToolContext(dir, "architect"))
      await applySkillDomainsTool(pluginInput).execute(
        { assignments: JSON.stringify({ "node-root": "docs" }) },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      promptCalls.length = 0

      await registerLeadForTest(pluginInput)
      const output = toolOutput(
        await missionRetroTool(pluginInput).execute(
          {},
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")

      expect(parsed.data.retro_order).toEqual(["node-root"])
      expect(parsed.data.forked).toBe(1)

      const skillKickoffs = parsed.data.skill_kickoffs
      expect(Array.isArray(skillKickoffs)).toBe(true)
      expect(skillKickoffs).toHaveLength(1)
      if (!Array.isArray(skillKickoffs) || !isRecord(skillKickoffs[0])) throw new Error("bad skill_kickoffs")
      expect(skillKickoffs[0].nodeId).toBe("node-root")
      expect(skillKickoffs[0].delivery).toBe("sent")

      const skillPrompts = promptCalls.filter((call) => call.text.includes("领域 skill 提炼"))
      expect(skillPrompts).toHaveLength(1)
      expect(skillPrompts[0]?.sessionId).toBe("ses_1")

      const retroPrompts = promptCalls.filter((call) => call.text.includes("复盘任务"))
      expect(retroPrompts).toHaveLength(1)
      expect(retroPrompts[0]?.sessionId.startsWith("ses_fork_")).toBe(true)
      expect(retroPrompts[0]?.text).toContain("node-root")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("skips skill kickoff when manifest has no skill_domain", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-retro-fork-empty-"))
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
          async fork() {
            sessionCounter += 1
            return { id: `ses_fork_${sessionCounter}` }
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
      await bootstrapTreeTool(pluginInput).execute(
        {},
        mockToolContext(dir, "architect"),
      )
      await applySkillDomainsTool(pluginInput).execute(
        { assignments: "{}" },
        mockToolContext(dir, "ses_curator", "curator"),
      )

      await registerLeadForTest(pluginInput)
      const output = toolOutput(
        await missionRetroTool(pluginInput).execute(
          {},
          mockToolContext(dir, "ses_lead", "lead"),
        ),
      )
      const parsed = parseYaml(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")
      const skillKickoffs = parsed.data.skill_kickoffs
      expect(Array.isArray(skillKickoffs)).toBe(true)
      expect(skillKickoffs).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
