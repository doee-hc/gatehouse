import path from "node:path"
import { mkdir } from "node:fs/promises"
import { DELIVERY_SCHEMA_VERSION } from "../src/delivery/types.ts"
import { stringifyYaml } from "../src/yaml.ts"

export async function seedSubmittedDelivery(projectDirectory: string, missionId: string) {
  const treeDir = path.join(projectDirectory, ".gatehouse", "trees", missionId)
  await mkdir(treeDir, { recursive: true })
  const reviewedAt = new Date().toISOString()
  await Bun.write(
    path.join(treeDir, "delivery.yaml"),
    stringifyYaml({
      schema_version: DELIVERY_SCHEMA_VERSION,
      mission_id: missionId,
      active: {
        version: 1,
        status: "submitted",
        submitted_at: reviewedAt,
        submitted_by_node: "root",
        report_path: `.gatehouse/trees/${missionId}/reports/root-delivery.md`,
        criteria: [],
        evidence: [],
        precheck: [],
      },
      history: [],
    }),
  )
}
