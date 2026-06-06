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

export function architectDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "architect")
}

export function treeDir(projectDirectory: string, missionId: string) {
  return path.join(architectDir(projectDirectory), "trees", missionId)
}

export function manifestPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "manifest.yaml")
}

export function retroManifestPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "retro-manifest.yaml")
}

export function teamSpecPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "teamspec.yaml")
}

export function dispatchRootPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/dispatch-root.md")
}

export function watchdogRootWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/watchdog-root-wake.md")
}

export function watchdogRetroRecordWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/watchdog-retro-record-wake.md")
}

export function watchdogSkillRecordWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/watchdog-skill-record-wake.md")
}

export function rootDeliveryPath(projectDirectory: string, missionId: string) {
  return path.join(treeDir(projectDirectory, missionId), "reports", "root-delivery.md")
}

export function treesIndexPath(projectDirectory: string) {
  return path.join(architectDir(projectDirectory), "trees-index.yaml")
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

export function retroNodeReportRelPath(missionId: string, nodeId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "reports", "nodes", `${nodeId}-retro.md`)
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
  return path.join(".gatehouse", "architect", "trees", missionId, "context", nodeId)
}

export function contextIndexRelPath(missionId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "context", "index.json")
}

export function retroAnalysisPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/retro-node-analysis.md")
}

export function domainSkillExtractPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "architect/meta-skill/prompts/domain-skill-extract.md")
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
  return resolveGatehouseContentPath(projectDirectory, "curator/meta-skill/prompts/skill-assign-kickoff.md")
}

export function curatorSkillSummaryRelPath(missionId: string, nodeId: string) {
  return path.join(".gatehouse", "architect", "trees", missionId, "reports", "skills", `${nodeId}-extract.md`)
}

export function portalOfficeDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office")
}

export function officeLayoutSpecPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office-layout.yaml")
}
