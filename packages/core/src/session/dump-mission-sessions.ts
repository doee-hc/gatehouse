import { readMissionManifest } from "../missions/manifest/store.ts"
import type { RegistryStore } from "../registry/store.ts"
import type { GatehouseClient } from "./client.ts"
import {
  dumpMissionContext,
  ensureMissionContextDumped,
  missionContextAlreadyDumped,
} from "./context-dump.ts"
import { dumpOuterSessionsForDebug } from "./debug-dump.ts"

export type DumpMissionSessionsScope = "inner" | "outer" | "all"

export async function dumpMissionSessionsForDebug(input: {
  client: GatehouseClient
  projectDirectory: string
  missionId: string
  registry: RegistryStore
  scope?: DumpMissionSessionsScope
  force?: boolean
}) {
  const scope = input.scope ?? "all"
  const wantInner = scope === "all" || scope === "inner"
  const wantOuter = scope === "all" || scope === "outer"

  let inner:
    | Awaited<ReturnType<typeof ensureMissionContextDumped>>
    | { skipped: true; mission_id: string; reason: "already_dumped" }
    | undefined

  if (wantInner) {
    const manifest = await readMissionManifest(input.projectDirectory, input.missionId)
    if (!manifest) {
      throw new Error(`mission manifest not found: ${input.missionId}`)
    }
    if (input.force || !missionContextAlreadyDumped(input.projectDirectory, input.missionId)) {
      inner = input.force
        ? { skipped: false as const, ...(await dumpMissionContext({ ...input, manifest })) }
        : await ensureMissionContextDumped({ ...input, manifest })
    } else {
      inner = {
        skipped: true as const,
        mission_id: input.missionId,
        reason: "already_dumped" as const,
      }
    }
  }

  const outer = wantOuter
    ? await dumpOuterSessionsForDebug({
        client: input.client,
        projectDirectory: input.projectDirectory,
        missionId: input.missionId,
        registry: input.registry,
      })
    : undefined

  return {
    mission_id: input.missionId,
    scope,
    inner,
    outer,
  }
}
