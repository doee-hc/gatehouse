import path from "node:path"
import { mkdir } from "node:fs/promises"
import { OUTER_PROFILES } from "../names.ts"
import {
  debugOuterSessionRelDir,
  debugSessionIndexRelPath,
  debugSessionMissionDir,
} from "../paths.ts"
import type { RegistryStore } from "../registry/store.ts"
import type { GatehouseClient } from "./client.ts"
import { dumpSessionContext, type NodeContextDump } from "./context-dump.ts"

/** Developer-only: dump outer agent sessions under .gatehouse/internal/debug/sessions/. */
export async function dumpOuterSessionsForDebug(input: {
  client: GatehouseClient
  projectDirectory: string
  missionId: string
  registry: RegistryStore
}) {
  const outerEntries: NodeContextDump[] = []
  for (const profile of OUTER_PROFILES) {
    const agent = input.registry.byProfile(profile, "outer")
    if (!agent?.sessionId) continue
    const relDir = debugOuterSessionRelDir(input.missionId, profile)
    const absDir = path.join(input.projectDirectory, relDir)
    const dumped = await dumpSessionContext({
      client: input.client,
      projectDirectory: input.projectDirectory,
      missionId: input.missionId,
      nodeId: profile,
      sessionId: agent.sessionId,
      profile,
      relDir,
      absDir,
    })
    const { metrics: _metrics, ...entry } = dumped
    outerEntries.push(entry)
  }

  const missionDir = debugSessionMissionDir(input.projectDirectory, input.missionId)
  await mkdir(missionDir, { recursive: true })
  const indexRel = debugSessionIndexRelPath(input.missionId)
  await Bun.write(
    path.join(missionDir, "index.json"),
    JSON.stringify(
      {
        mission_id: input.missionId,
        dumped_at: new Date().toISOString(),
        note:
          "Debug-only outer agent session dump. Gatehouse runtime does not read this; " +
          "inner execution context remains under .gatehouse/trees/<mission_id>/context/.",
        outer: outerEntries,
      },
      null,
      2,
    ),
  )

  return {
    mission_id: input.missionId,
    index_path: indexRel,
    outer_count: outerEntries.length,
    outer: outerEntries.map((entry) => ({
      profile: entry.node_id,
      session_id: entry.session_id,
      rel_dir: entry.rel_dir,
    })),
  }
}
