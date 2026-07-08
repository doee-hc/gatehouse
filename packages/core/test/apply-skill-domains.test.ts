import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { applySkillDomainsTool } from "../src/tools/apply-skill-domains.ts"
import { submitOrchestrationTool } from "../src/tools/submit-orchestration.ts"
import { copyExampleMission } from "./copy-example-mission.ts"
import { getRegistryStore } from "../src/registry/context.ts"
import { OUTER_ARCHITECT_ID, OUTER_CURATOR_ID } from "../src/registry/types.ts"
import { isRecord } from "../src/yaml.ts"
import { stopSandboxOrchestration } from "../src/orchestration/sandbox/runtime.ts"

function parseToolOutput(output: string) {
  return JSON.parse(output) as unknown
}

const scaffoldScript = path.join(import.meta.dir, "../script/scaffold.ts")

function toolOutput(result: Awaited<ReturnType<ReturnType<typeof applySkillDomainsTool>["execute"]>>) {
  return typeof result === "string" ? result : result.output
}

function mockToolContext(directory: string, agent = "curator", sessionID = "ses_curator"): ToolContext {
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

async function bootstrapExampleMission(pluginInput: PluginInput, directory: string) {
  const preStore = await getRegistryStore(pluginInput)
  preStore.register({
    agentId: OUTER_ARCHITECT_ID,
    scope: "outer",
    profile: "architect",
    sessionId: "ses_architect",
    displayName: "Architect",
  })
  preStore.register({
    agentId: OUTER_CURATOR_ID,
    scope: "outer",
    profile: "curator",
    sessionId: "ses_curator",
    displayName: "Curator",
  })
  await submitOrchestrationTool(pluginInput).execute({}, mockToolContext(directory, "architect", "ses_architect"))
}

describe("apply skill domains", () => {
  test("rejects assignments that reference unregistered domain ids", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-apply-skill-domains-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      const pluginInput = { directory: dir, client: { session: {} } } as unknown as PluginInput
      const preStore = await getRegistryStore(pluginInput)
      preStore.register({
        agentId: OUTER_CURATOR_ID,
        scope: "outer",
        profile: "curator",
        sessionId: "ses_curator",
        displayName: "Curator",
      })

      const output = toolOutput(
        await applySkillDomainsTool(pluginInput).execute(
          { assignments: [{ node_id: "node-doc", domain_id: "brand-new-domain" }] },
          mockToolContext(dir),
        ),
      )
      const parsed = parseToolOutput(output)
      if (!isRecord(parsed) || !isRecord(parsed.error)) throw new Error("unexpected tool output")
      expect(parsed.ok).toBe(false)
      expect(parsed.error.code).toBe("UNKNOWN_SKILL_DOMAIN")
      expect(String(parsed.error.message)).toContain("brand-new-domain")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("updates running mission manifest when domain id exists in domains.yaml", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-apply-skill-domains-ok-"))
    try {
      await Bun.$`bun ${scaffoldScript} ${dir}`.quiet()
      await copyExampleMission(dir)

      const pluginInput = {
        directory: dir,
        client: {
          session: {
            async create() {
              return { id: "ses_inner" }
            },
            async promptAsync() {},
            async messages() {
              return { data: [] }
            },
            async get() {
              return { data: {} }
            },
            async status() {
              return { data: {} }
            },
          },
        },
      } as unknown as PluginInput

      await bootstrapExampleMission(pluginInput, dir)

      const output = toolOutput(
        await applySkillDomainsTool(pluginInput).execute(
          { assignments: [{ node_id: "node-doc", domain_id: "docs" }] },
          mockToolContext(dir),
        ),
      )
      const parsed = parseToolOutput(output)
      if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("unexpected tool output")
      expect(parsed.ok).toBe(true)
      expect(parsed.data.phase).toBe("manifest_updated")
    } finally {
      stopSandboxOrchestration("core-example-smoke-v1")
      await rm(dir, { recursive: true, force: true })
    }
  })
})
