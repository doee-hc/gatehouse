/**
 * Generate project office layout from office-layout-gen (all inner nodes → cubicles,
 * outer four agents → boss office seats).
 *
 * Usage:
 *   GATEHOUSE_PROJECT_DIR=/path/to/project bun run import:office-layout
 */
import path from "node:path"

const projectDirectory = path.resolve(process.env.GATEHOUSE_PROJECT_DIR ?? process.cwd())
const corePortal = path.join(import.meta.dir, "..", "..", "core", "src", "portal")

const { syncOfficeLayout } = await import(path.join(corePortal, "office-layout-generate.ts"))

const result = await syncOfficeLayout(projectDirectory)
console.log(
  `import:office-layout: ${result.status} — ${result.spec.workstation_count} inner workstations, revision ${result.spec.revision}`,
)
if ("warnings" in result && result.warnings?.length) {
  for (const warning of result.warnings) console.warn(`  warning: ${warning}`)
}
if (result.manifest?.warnings?.length) {
  for (const warning of result.manifest.warnings) console.warn(`  manifest: ${warning}`)
}
