import { existsSync } from "node:fs"
import path from "node:path"
import { readLocaleSync, type GatehouseLocale } from "./locale.ts"

const bundledTemplateRoot = path.join(import.meta.dir, "..", "templates")

export function bundledGatehouseTemplateRoot(locale: GatehouseLocale) {
  return path.join(bundledTemplateRoot, locale, "gatehouse")
}

export function gatehouseLocaleRoot(projectDirectory: string, locale: GatehouseLocale) {
  return path.join(gatehouseRoot(projectDirectory), locale)
}

export function resolveGatehouseContentPath(projectDirectory: string, relative: string): string {
  const locale = readLocaleSync(projectDirectory)
  const candidates = [
    path.join(gatehouseLocaleRoot(projectDirectory, locale), relative),
    path.join(gatehouseRoot(projectDirectory), relative),
    path.join(bundledGatehouseTemplateRoot(locale), relative),
    ...(locale !== "zh" ? [path.join(bundledGatehouseTemplateRoot("zh"), relative)] : []),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

export function resolveProjectPath(projectDirectory: string, value: string) {
  return path.isAbsolute(value) ? value : path.join(projectDirectory, value)
}

export function gatehouseRoot(projectDirectory: string) {
  return path.join(projectDirectory, ".gatehouse")
}

export function portalRuntimePath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal-runtime.json")
}

export function leadDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "lead")
}

export function treesDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "trees")
}

export function treeDir(projectDirectory: string, missionId: string) {
  return path.join(treesDir(projectDirectory), missionId)
}

export function treeRelDir(missionId: string) {
  return path.join(".gatehouse", "trees", missionId)
}

/** Human/debug YAML export root — not an agent runtime interface. */
export function internalExportsDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "internal", "exports")
}

/** Debug-only session dumps — Gatehouse runtime never reads these. */
export function debugSessionsDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "internal", "debug", "sessions")
}

export function debugSessionMissionDir(projectDirectory: string, missionId: string) {
  return path.join(debugSessionsDir(projectDirectory), missionId)
}

export function debugOuterSessionRelDir(missionId: string, profile: string) {
  return path.join(".gatehouse", "internal", "debug", "sessions", missionId, "outer", profile)
}

export function debugSessionIndexRelPath(missionId: string) {
  return path.join(".gatehouse", "internal", "debug", "sessions", missionId, "index.json")
}

export function manifestExportPath(projectDirectory: string, missionId: string) {
  return path.join(internalExportsDir(projectDirectory), "trees", missionId, "manifest.yaml")
}

export function retroManifestExportPath(projectDirectory: string, missionId: string) {
  return path.join(internalExportsDir(projectDirectory), "trees", missionId, "retro-manifest.yaml")
}

/** Pre-internal-layout path; import fallback only. */
export function legacyManifestPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "manifest.yaml")
}

export function legacyRetroManifestPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "retro-manifest.yaml")
}

/** @deprecated Use manifestExportPath — kept for import fallback call sites. */
export function manifestPath(projectDirectory: string, missionId: string) {
  return manifestExportPath(projectDirectory, missionId)
}

/** @deprecated Use retroManifestExportPath — kept for import fallback call sites. */
export function retroManifestPath(projectDirectory: string, missionId: string) {
  return retroManifestExportPath(projectDirectory, missionId)
}

export function missionScriptPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "mission.script.ts")
}

export function missionScriptRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "mission.script.ts")
}

export function missionContractPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "mission-contract.yaml")
}

export function missionContractRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "mission-contract.yaml")
}

export function nodeBriefRelPath(missionId: string, nodeId: string) {
  return path.join(treeRelDir(missionId), "node-briefs", `${nodeId}.yaml`)
}

export function watchdogNodeWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/watchdog-node-wake.md")
}

export function watchdogRetroRecordWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/watchdog-retro-record-wake.md")
}

export function watchdogSkillRecordWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/watchdog-skill-record-wake.md")
}

export function rootDeliveryPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "reports", "root-delivery.md")
}

export function treesIndexPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "trees-index.yaml")
}

export function nodeDisplayLabel(nodeId: string) {
  return nodeId.startsWith("node-") ? nodeId.slice(5) : nodeId
}

export function portalNodeDisplayName(nodeId: string, displayName?: string) {
  return displayName ?? nodeDisplayLabel(nodeId)
}

export function sessionTitle(_missionId: string, nodeId: string, retro = false) {
  const label = nodeDisplayLabel(nodeId)
  if (!retro) return label
  return `[retro] ${label}`
}

export function retroSessionTitle(missionId: string, nodeId: string) {
  return sessionTitle(missionId, nodeId, true)
}

export function nodeDeliveryRelPath(missionId: string, nodeId: string) {
  return path.join(treeRelDir(missionId), "reports", "nodes", `${nodeId}-delivery.md`)
}

export function nodeDeliveryReportPath(projectDirectory: string, missionId: string, nodeId: string) {
  return path.join(projectDirectory, nodeDeliveryRelPath(missionId, nodeId))
}

export function retroNodeReportRelPath(missionId: string, nodeId: string) {
  return path.join(treeRelDir(missionId), "reports", "nodes", `${nodeId}-retro.md`)
}

export function retroNodeReportPath(projectDirectory: string, missionId: string, nodeId: string) {
  return path.join(projectDirectory, retroNodeReportRelPath(missionId, nodeId))
}

export function contextDir(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "context")
}

export function nodeContextDir(projectDirectory: string, missionId: string, nodeId: string) {
  return path.join(contextDir(projectDirectory, missionId), nodeId)
}

export function nodeContextRelDir(missionId: string, nodeId: string) {
  return path.join(treeRelDir(missionId), "context", nodeId)
}

export function contextIndexRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "context", "index.json")
}

export function retroAnalysisPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/retro-node-analysis.md")
}

export function domainSkillExtractPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/domain-skill-extract.md")
}

export function skillDomainDir(domainId: string) {
  return path.join(".gatehouse", "skills", "by-domain", domainId)
}

export function skillDomainsRegistryPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "skills", "domains.yaml")
}

export function curatorDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "curator")
}

export function curatorSkillAssignKickoffPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/curator/skill-assign-kickoff.md")
}

export function curatorSkillSummaryRelPath(missionId: string, nodeId: string) {
  return path.join(treeRelDir(missionId), "reports", "skills", `${nodeId}-extract.md`)
}

export function architectSummaryRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "reports", "architect-summary.md")
}

export function rootDeliveryRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "reports", "root-delivery.md")
}

export function deliveryDocumentPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "delivery.yaml")
}

export function deliveryDocumentRelPath(missionId: string) {
  return path.join(treeRelDir(missionId), "delivery.yaml")
}

export function deliveryRevisionPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/delivery-revision.md")
}

export function portalOfficeDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office")
}

export function officeLayoutSpecPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office-layout.yaml")
}
