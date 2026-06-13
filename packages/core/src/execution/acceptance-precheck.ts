import {
  criteriaFromStringList,
  formatPrecheckSummary,
  precheckHasUnmet,
  runDeliveryPrecheck,
} from "../delivery/criteria.ts"
import type { DoneWhenCriterion, DeliveryPrecheck } from "../delivery/types.ts"

export type AcceptancePrecheckResult =
  | { ok: true; precheck: DeliveryPrecheck[]; criteria: DoneWhenCriterion[] }
  | {
      ok: false
      precheck: DeliveryPrecheck[]
      criteria: DoneWhenCriterion[]
      message: string
    }

export async function runAcceptanceSlicePrecheck(
  projectDirectory: string,
  acceptanceSlice: string[],
): Promise<AcceptancePrecheckResult> {
  const criteria = criteriaFromStringList(acceptanceSlice)
  if (criteria.length === 0) {
    return { ok: true, precheck: [], criteria: [] }
  }
  const precheck = await runDeliveryPrecheck(projectDirectory, criteria)
  if (!precheckHasUnmet(precheck)) {
    return { ok: true, precheck, criteria }
  }
  const failed = precheck.filter((item) => item.status === "unmet")
  const summary = formatPrecheckSummary(precheck, criteria).join("\n")
  return {
    ok: false,
    precheck,
    criteria,
    message:
      `Acceptance slice precheck failed for ${failed.length} criterion(s). ` +
      `Fix deliverables or update acceptance_slice in the node brief before gatehouse_execution_complete.\n${summary}`,
  }
}
