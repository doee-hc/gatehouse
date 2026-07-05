import { existsSync, statSync } from "node:fs"
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

export type ProjectPathKind = "file" | "directory"

/** Whether a project-relative path exists as a file or directory (not only Bun.file). */
export function projectPathKind(projectDirectory: string, relPath: string): ProjectPathKind | undefined {
  const abs = resolveProjectPath(projectDirectory, relPath)
  if (!existsSync(abs)) return undefined
  try {
    const stat = statSync(abs)
    if (stat.isFile()) return "file"
    if (stat.isDirectory()) return "directory"
  } catch {
    return undefined
  }
  return undefined
}

export function projectPathExists(projectDirectory: string, relPath: string) {
  return projectPathKind(projectDirectory, relPath) !== undefined
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

export function missionsDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "missions")
}

export function missionDir(projectDirectory: string, missionId: string) {
  return path.join(missionsDir(projectDirectory), missionId)
}

export function missionRelDir(missionId: string) {
  return path.join(".gatehouse", "missions", missionId)
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
  return path.join(internalExportsDir(projectDirectory), "missions", missionId, "manifest.yaml")
}

export function retroManifestExportPath(projectDirectory: string, missionId: string) {
  return path.join(internalExportsDir(projectDirectory), "missions", missionId, "retro-manifest.yaml")
}

export function extractManifestExportPath(projectDirectory: string, missionId: string) {
  return path.join(internalExportsDir(projectDirectory), "missions", missionId, "extract-manifest.yaml")
}

export function verifyManifestExportPath(projectDirectory: string, missionId: string) {
  return path.join(internalExportsDir(projectDirectory), "missions", missionId, "verify-manifest.yaml")
}

export function missionScriptPath(projectDirectory: string, missionId: string) {
  return path.join(missionDir(projectDirectory, missionId), "mission.script.ts")
}

export function missionScriptRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "mission.script.ts")
}

export function missionContractPath(projectDirectory: string, missionId: string) {
  return path.join(missionDir(projectDirectory, missionId), "mission-contract.yaml")
}

export function missionContractRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "mission-contract.yaml")
}

export function nodeBriefRelPath(missionId: string, nodeId: string) {
  return path.join(missionRelDir(missionId), "node-briefs", `${nodeId}.yaml`)
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

export function watchdogSkillVerifyRecordWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/watchdog-skill-verify-record-wake.md")
}

export function autopilotWakePromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/lead/autopilot-wake.md")
}

export function autopilotEnabledPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/lead/autopilot-enabled.md")
}

export function watchdogOrchestratorStallPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/watchdog-orchestrator-stall.md")
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

export function retroSessionTitle(missionId: string) {
  return `[retro] ${nodeDisplayLabel(missionId)}`
}

export function retroSummaryRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "reports", "retro-summary.md")
}

export function retroSummaryTemplatePath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/retro-summary.template.md")
}

export function extractSessionTitle(missionId: string, nodeId: string) {
  return `[extract] ${nodeDisplayLabel(nodeId)}`
}

export function verifySessionTitle(missionId: string, nodeId: string) {
  return `[verify] ${nodeDisplayLabel(nodeId)}`
}

export function contextDir(projectDirectory: string, missionId: string) {
  return path.join(missionDir(projectDirectory, missionId), "context")
}

export function nodeContextDir(projectDirectory: string, missionId: string, nodeId: string) {
  return path.join(contextDir(projectDirectory, missionId), nodeId)
}

export type PhaseContextScope = "retro" | "extract" | "verify"

export function phaseContextDir(
  projectDirectory: string,
  missionId: string,
  phase: PhaseContextScope,
  nodeId: string,
) {
  return path.join(contextDir(projectDirectory, missionId), phase, nodeId)
}

export function nodeContextRelDir(missionId: string, nodeId: string) {
  return path.join(missionRelDir(missionId), "context", nodeId)
}

export function contextIndexRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "context", "index.json")
}

export function retroKickoffPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/retro-analyst-kickoff.md")
}

export function domainSkillExtractPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/domain-skill-extract.md")
}

export function domainSkillVerifyPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/domain-skill-verify.md")
}

export function skillVerifyReportRelPath(missionId: string, nodeId: string) {
  return path.join(missionRelDir(missionId), "reports", "skills", `${nodeId}-verify.md`)
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
  return path.join(missionRelDir(missionId), "reports", "skills", `${nodeId}-extract.md`)
}

export function architectSummaryRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "reports", "architect-summary.md")
}

export function curatorSummaryRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "reports", "curator-summary.md")
}

export function deliveryDocumentPath(projectDirectory: string, missionId: string) {
  return path.join(missionDir(projectDirectory, missionId), "delivery.yaml")
}

export function deliveryDocumentRelPath(missionId: string) {
  return path.join(missionRelDir(missionId), "delivery.yaml")
}

export function deliveryRevisionPromptPath(projectDirectory: string) {
  return resolveGatehouseContentPath(projectDirectory, "prompts/architect/delivery-revision.md")
}

export function portalOfficeDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office")
}

export function portalOfflineCacheDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "cache")
}

/** Browser-servable offline bundle (rsync to VPS static root as offline-cache/). */
export function portalStaticOfflineCacheDir(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "static-cache")
}

export function officeLayoutSpecPath(projectDirectory: string) {
  return path.join(gatehouseRoot(projectDirectory), "portal", "office-layout.yaml")
}
