import { describe, expect, test } from "bun:test"
import { parseNodeBrief, formatNodeBriefBlock } from "../src/execution/brief.ts"
import { freezeMissionContract } from "../src/missions/contract-freeze.ts"
import { missionEntryToRecord } from "../src/missions/contract.ts"
import { parseMissionRawDoneWhenFromContractRaw } from "../src/registry/mission-artifacts-db.ts"
import { RegistryDatabase } from "../src/registry/db.ts"
import { stringifyYaml } from "../src/yaml.ts"
import { internalExportsDir, leadDir } from "../src/paths.ts"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("execution artifacts", () => {
  test("parseNodeBrief and format block", () => {
    const brief = parseNodeBrief(
      `
node_id: mem-a
your_work:
  - chat with peers
not_your_job:
  - contact lead
acceptance_slice:
  - log lines valid
`,
      "mem-a",
    )
    expect(brief.your_work).toEqual(["chat with peers"])
    const block = formatNodeBriefBlock(brief)
    expect(block).toContain("mem-a")
    expect(block).toContain("chat with peers")
    expect(block).toContain("gatehouse_mission_info")
  })

  test("freezeMissionContract preserves structured done_when in registry.db", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gh-freeze-contract-"))
    try {
      await mkdir(leadDir(dir), { recursive: true })
      const missionsPath = path.join(leadDir(dir), "missions.yaml")
      await Bun.write(
        missionsPath,
        stringifyYaml({
          schema_version: 2,
          missions: [
            {
              id: "m-freeze",
              status: "queued",
              objective: "test",
              done_when: [
                { text: "cmd ok", check: { kind: "command", cmd: "true", expect_exit: 0 } },
              ],
              must_not: [],
            },
          ],
        }),
      )

      const registry = new RegistryDatabase(dir)
      const lockedAt = new Date().toISOString()
      registry.activateMission(
        missionEntryToRecord(
          {
            id: "m-freeze",
            status: "running",
            objective: "test",
            done_when: ["cmd ok"],
            must_not: [],
            started_at: lockedAt,
          },
          { lockedAt, isActive: true, status: "running" },
        ),
      )

      await freezeMissionContract(dir, "m-freeze")
      const raw = registry.getMissionContractRaw("m-freeze")
      const doneWhen = parseMissionRawDoneWhenFromContractRaw(raw)
      expect(doneWhen?.[0]).toMatchObject({ text: "cmd ok" })

      const exportPath = path.join(internalExportsDir(dir), "trees", "m-freeze", "mission-contract.yaml")
      expect(await Bun.file(exportPath).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
