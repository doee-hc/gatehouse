import { test, expect } from "bun:test"
import {
  parseMissionsFile,
  portalMissionIds,
  retroMissionIds,
  runningMissionIds,
  assertCanStartRunning,
  assertMissionRunning,
  activePortalMissionIds,
  lingeringPortalMissionId,
} from "../src/missions/parse.ts"

test("parseMissionsFile reads missions without policy block", () => {
  const doc = parseMissionsFile(`
schema_version: 2
missions:
  - id: a
    status: running
  - id: b
    status: queued
`)
  expect(doc.missions.map((mission) => mission.id)).toEqual(["a", "b"])
  expect(runningMissionIds(doc)).toEqual(["a"])
})

test("parseMissionsFile ignores legacy policy.max_running", () => {
  const doc = parseMissionsFile(`
schema_version: 2
policy:
  max_running: 3
missions:
  - id: a
    status: queued
`)
  expect(doc.missions).toHaveLength(1)
})

test("retroMissionIds and portalMissionIds", () => {
  const doc = parseMissionsFile(`
missions:
  - id: run
    status: running
  - id: retro
    status: retro
  - id: done
    status: done
`)
  expect(runningMissionIds(doc)).toEqual(["run"])
  expect(retroMissionIds(doc)).toEqual(["retro"])
  expect(portalMissionIds(doc)).toEqual(["run"])
})

test("activePortalMissionIds prefers running over retro", () => {
  const doc = parseMissionsFile(`
missions:
  - id: run
    status: running
    started_at: "2026-05-31T10:00:00Z"
  - id: retro
    status: retro
    started_at: "2026-05-30T10:00:00Z"
`)
  expect(activePortalMissionIds(doc)).toEqual(["run"])
})

test("activePortalMissionIds picks newest when multiple running (invalid state)", () => {
  const doc = parseMissionsFile(`
missions:
  - id: old
    status: running
    started_at: "2026-05-30T10:00:00Z"
  - id: new
    status: running
    started_at: "2026-05-31T10:00:00Z"
`)
  expect(activePortalMissionIds(doc)).toEqual(["new"])
})

test("lingeringPortalMissionId picks newest done mission when idle", () => {
  const doc = parseMissionsFile(`
missions:
  - id: old
    status: done
    started_at: "2026-05-30T10:00:00Z"
  - id: recent
    status: done
    started_at: "2026-05-31T10:00:00Z"
  - id: run
    status: running
    started_at: "2026-06-01T10:00:00Z"
`)
  expect(lingeringPortalMissionId(doc)).toBeUndefined()
  doc.missions.find((mission) => mission.id === "run")!.status = "done"
  expect(lingeringPortalMissionId(doc)).toBe("run")
})

test("assertCanStartRunning throws when another mission is running", () => {
  const doc = parseMissionsFile(`
missions:
  - id: a
    status: running
`)
  let message = ""
  try {
    assertCanStartRunning(doc)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("running")
})

test("assertCanStartRunning throws when retro is in progress", () => {
  const doc = parseMissionsFile(`
missions:
  - id: a
    status: retro
`)
  let message = ""
  try {
    assertCanStartRunning(doc)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("retro")
})

test("assertMissionRunning requires running status", () => {
  const doc = parseMissionsFile(`
missions:
  - id: a
    status: queued
`)
  let message = ""
  try {
    assertMissionRunning(doc, "a")
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("running")
})

test("assertMissionRunning throws when mission id is missing", () => {
  const doc = parseMissionsFile(`missions: []`)
  let message = ""
  try {
    assertMissionRunning(doc, "ghost")
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain("not found")
})
