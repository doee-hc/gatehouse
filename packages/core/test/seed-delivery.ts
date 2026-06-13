import { DELIVERY_SCHEMA_VERSION } from "../src/delivery/types.ts"
import { RegistryDatabase } from "../src/registry/db.ts"

export async function seedSubmittedDelivery(projectDirectory: string, missionId: string) {
  const reviewedAt = new Date().toISOString()
  const registry = new RegistryDatabase(projectDirectory)
  registry.saveDeliveryDocument({
    schema_version: DELIVERY_SCHEMA_VERSION,
    mission_id: missionId,
    active: {
      version: 1,
      status: "submitted",
      submitted_at: reviewedAt,
      submitted_by_node: "root",
      criteria: [],
      evidence: [],
      precheck: [],
    },
    history: [],
  })
}
