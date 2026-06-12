import path from "node:path"
import { resolveProjectPath } from "../paths.ts"
import { isRecord, parseYaml, readString } from "../yaml.ts"
import type { MissionEntry } from "../missions/parse.ts"
import { readMissionRawDoneWhen as readMissionRawDoneWhenFromRegistry } from "../execution/artifacts.ts"
import type { DoneWhenCheck, DoneWhenCriterion, DeliveryPrecheck } from "./types.ts"

export { readMissionRawDoneWhenFromRegistry as readMissionRawDoneWhen }

function parseCheck(value: unknown, fallbackPath?: string): DoneWhenCheck {
  if (isRecord(value)) {
    const kind = readString(value.kind)
    if (kind === "path_exists") {
      const filePath = readString(value.path) ?? fallbackPath
      if (filePath) return { kind: "path_exists", path: filePath }
    }
    if (kind === "command") {
      const cmd = readString(value.cmd)
      if (cmd) {
        const expectExit = typeof value.expect_exit === "number" ? value.expect_exit : 0
        return { kind: "command", cmd, expect_exit: expectExit }
      }
    }
    if (kind === "manual") return { kind: "manual" }
  }
  if (fallbackPath) return { kind: "path_exists", path: fallbackPath }
  return { kind: "manual" }
}

function parsePublishPath(item: Record<string, unknown>, pathValue?: string) {
  const publishRaw = item.publish
  if (typeof publishRaw === "string" && publishRaw.trim() && publishRaw !== "true" && publishRaw !== "false") {
    return publishRaw.trim()
  }
  if (publishRaw === true && pathValue) return pathValue
  if (publishRaw === true) return undefined
  return undefined
}

function parseCriterionItem(item: unknown, id: number): DoneWhenCriterion | undefined {
  if (typeof item === "string" && item.trim()) {
    return { id, text: item.trim(), check: { kind: "manual" } }
  }
  if (!isRecord(item)) return undefined
  const pathValue = readString(item.path)
  const publishOnly = readString(item.publish)
  if (!pathValue && !readString(item.text) && publishOnly && publishOnly !== "true" && publishOnly !== "false") {
    const publishPath = publishOnly.trim()
    return {
      id,
      text: `交付物: ${publishPath}`,
      check: { kind: "path_exists", path: publishPath },
      publishPath,
    }
  }
  const text =
    readString(item.text) ??
    (pathValue ? `文件存在: ${pathValue}` : readString(item.id) ?? undefined)
  if (!text?.trim()) return undefined
  const check = parseCheck(item.check, pathValue)
  const publishPath = parsePublishPath(item, pathValue)
  return {
    id,
    text: text.trim(),
    check,
    ...(publishPath && { publishPath }),
  }
}

/** Parse structured done_when from raw missions.yaml mission entry. */
export function parseDoneWhenCriteriaFromRaw(item: Record<string, unknown>): DoneWhenCriterion[] {
  const raw = item.done_when
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry, index) => {
    const criterion = parseCriterionItem(entry, index)
    return criterion ? [criterion] : []
  })
}

/** Build criteria from a parsed mission entry (re-read raw yaml when possible). */
export function criteriaFromMissionEntry(
  entry: MissionEntry,
  rawDoneWhen?: unknown[],
): DoneWhenCriterion[] {
  if (rawDoneWhen && rawDoneWhen.length > 0) {
    const parsed = rawDoneWhen.flatMap((item, index) => {
      const criterion = parseCriterionItem(item, index)
      return criterion ? [criterion] : []
    })
    if (parsed.length > 0) return parsed
  }
  return entry.done_when.map((text, id) => {
    const pathMatch = text.match(/^文件存在:\s*(.+)$/)
    if (pathMatch?.[1]) {
      return {
        id,
        text,
        check: { kind: "path_exists", path: pathMatch[1].trim() },
      }
    }
    return { id, text, check: { kind: "manual" } }
  })
}

async function runCommandCheck(projectDirectory: string, check: Extract<DoneWhenCheck, { kind: "command" }>) {
  const proc = Bun.spawn(["sh", "-c", check.cmd], {
    cwd: projectDirectory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeoutMs = 120_000
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const exitCode = await proc.exited
  clearTimeout(timer)
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const expectExit = check.expect_exit ?? 0
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 500)
  if (exitCode === expectExit) {
    return { status: "met" as const, detail: output || `exit ${exitCode}` }
  }
  return {
    status: "unmet" as const,
    detail: output ? `exit ${exitCode}: ${output}` : `exit ${exitCode}`,
  }
}

export async function runDeliveryPrecheck(
  projectDirectory: string,
  criteria: DoneWhenCriterion[],
): Promise<DeliveryPrecheck[]> {
  const results: DeliveryPrecheck[] = []
  for (const criterion of criteria) {
    if (criterion.check.kind === "path_exists") {
      const abs = resolveProjectPath(projectDirectory, criterion.check.path)
      const exists = await Bun.file(abs).exists()
      results.push({
        criterion_id: criterion.id,
        status: exists ? "met" : "unmet",
        detail: exists ? "file exists" : `missing: ${criterion.check.path}`,
      })
      continue
    }
    if (criterion.check.kind === "command") {
      const result = await runCommandCheck(projectDirectory, criterion.check)
      results.push({
        criterion_id: criterion.id,
        status: result.status,
        detail: result.detail,
      })
      continue
    }
    results.push({
      criterion_id: criterion.id,
      status: "skipped",
      detail: "manual review required",
    })
  }
  return results
}

export function precheckHasUnmet(precheck: DeliveryPrecheck[]) {
  return precheck.some((item) => item.status === "unmet")
}

export function formatPrecheckSummary(precheck: DeliveryPrecheck[], criteria: DoneWhenCriterion[]) {
  const byId = new Map(criteria.map((item) => [item.id, item.text]))
  return precheck.map((item) => {
    const label = byId.get(item.criterion_id) ?? `criterion ${item.criterion_id}`
    return `- [${item.criterion_id}] ${label} — ${item.status}: ${item.detail}`
  })
}
