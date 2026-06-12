import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { collectMissionPublishWarnings } from "../src/missions/contract-audit.ts"

async function writeMissionYaml(dir: string, missionId: string, doneWhen: string) {
  await mkdir(path.join(dir, ".gatehouse/lead"), { recursive: true })
  await Bun.write(
    path.join(dir, ".gatehouse/lead/missions.yaml"),
    `schema_version: 3
missions:
  - id: ${missionId}
    status: queued
    objective: demo
    done_when:
${doneWhen}
    must_not: []
`,
  )
}

test("collectMissionPublishWarnings flags path deliverables without publish", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-contract-audit-"))
  try {
    const missionId = "m-pub-warn"
    await writeMissionYaml(
      dir,
      missionId,
      `      - path: docs/report.md
      - text: "article ready"
        path: content/post.md
        publish: content/post.md`,
    )
    const warnings = await collectMissionPublishWarnings(dir, missionId)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("docs/report.md")
    expect(warnings[0]).toContain("publish:")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("collectMissionPublishWarnings is silent when publish matches path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gh-contract-audit-ok-"))
  try {
    const missionId = "m-pub-ok"
    await writeMissionYaml(
      dir,
      missionId,
      `      - publish: content/post.md`,
    )
    const warnings = await collectMissionPublishWarnings(dir, missionId)
    expect(warnings).toHaveLength(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
