import { parseDoneWhenCriteriaFromRaw } from "../delivery/criteria.ts"
import { normalizeProjectRelPath, publishPathsFromCriteria } from "../delivery/publish-policy.ts"
import { readRawMissionEntryFromYaml } from "../execution/artifacts.ts"
import { isRecord } from "../yaml.ts"

function deliverablePathsFromRawDoneWhen(rawDoneWhen: unknown[]) {
  const paths = new Set<string>()
  const criteria = parseDoneWhenCriteriaFromRaw({ done_when: rawDoneWhen })
  for (const criterion of criteria) {
    if (criterion.check.kind === "path_exists") {
      const normalized = normalizeProjectRelPath(criterion.check.path)
      if (!normalized.startsWith(".gatehouse/")) paths.add(normalized)
    }
  }
  return paths
}

/** Non-blocking audit before mission_start — surfaces Portal publish gaps early. */
export async function collectMissionPublishWarnings(projectDirectory: string, missionId: string) {
  const rawEntry = await readRawMissionEntryFromYaml(projectDirectory, missionId)
  if (!isRecord(rawEntry) || !Array.isArray(rawEntry.done_when)) return []

  const rawDoneWhen = rawEntry.done_when
  const criteria = parseDoneWhenCriteriaFromRaw({ done_when: rawDoneWhen })
  const publishPaths = new Set(
    publishPathsFromCriteria(criteria).map((item) => normalizeProjectRelPath(item)),
  )
  const deliverablePaths = deliverablePathsFromRawDoneWhen(rawDoneWhen)

  const warnings: string[] = []
  for (const deliverablePath of deliverablePaths) {
    if (!publishPaths.has(deliverablePath)) {
      warnings.push(
        `done_when references deliverable path "${deliverablePath}" without a matching publish: entry; ` +
          `delivery auto-publish on accept will be blocked after gatehouse_mission_start ` +
          `(contract is frozen — add publish: before start)`,
      )
    }
  }
  return warnings
}
