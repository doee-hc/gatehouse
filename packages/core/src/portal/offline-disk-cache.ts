import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type { PortalBrandingResponse } from "./branding.ts"
import {
  type BrowserBlogSnapshot,
  type BrowserPortalSkillDetail,
  type BrowserPortalSnapshot,
  type BrowserTeamStatsSnapshot,
  toBrowserSkillDetail,
} from "./browser-dto.ts"
import { portalOfflineCacheDir } from "../paths.ts"
import { toBrowserDisplayConfig } from "./portal-display-settings.ts"
import { readSkillDetail } from "./skill.ts"
import type { PortalSkill } from "./snapshot.ts"

export const PORTAL_OFFLINE_DISK_CACHE_VERSION = 1

export type BrowserPortalDisplayConfig = ReturnType<typeof toBrowserDisplayConfig>

export type PortalOfflineSkillsCache = Record<string, BrowserPortalSkillDetail>

export type PortalOfflineDiskManifest = {
  v: typeof PORTAL_OFFLINE_DISK_CACHE_VERSION
  savedAt: string
  files: {
    snapshot?: boolean
    blog?: boolean
    branding?: boolean
    displayConfig?: boolean
    teamStats?: boolean
    skills?: boolean
  }
}

export type PortalOfflineDiskBundle = {
  v: typeof PORTAL_OFFLINE_DISK_CACHE_VERSION
  savedAt: string
  snapshot?: BrowserPortalSnapshot
  blog?: BrowserBlogSnapshot
  branding?: PortalBrandingResponse
  displayConfig?: BrowserPortalDisplayConfig
  teamStats?: BrowserTeamStatsSnapshot
  skills?: PortalOfflineSkillsCache
}

type OfflineCacheFileName =
  | "manifest.json"
  | "snapshot.json"
  | "blog.json"
  | "branding.json"
  | "display-config.json"
  | "team-stats.json"
  | "skills.json"

export type PortalOfflineDiskPatch = Partial<
  Pick<
    PortalOfflineDiskBundle,
    "snapshot" | "blog" | "branding" | "displayConfig" | "teamStats" | "skills"
  >
>

export function portalOfflineSkillCacheKey(domain: string, name: string) {
  return `${domain}/${name}`
}

function cacheFilePath(projectDirectory: string, file: OfflineCacheFileName) {
  return path.join(portalOfflineCacheDir(projectDirectory), file)
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return undefined
  try {
    return (await file.json()) as T
  } catch {
    return undefined
  }
}

async function writeJsonFile(filePath: string, data: unknown) {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await Bun.write(tmp, JSON.stringify(data))
  await rename(tmp, filePath)
}

export async function readPortalOfflineDiskManifest(projectDirectory: string) {
  const manifest = await readJsonFile<PortalOfflineDiskManifest>(
    cacheFilePath(projectDirectory, "manifest.json"),
  )
  if (!manifest || manifest.v !== PORTAL_OFFLINE_DISK_CACHE_VERSION) return undefined
  return manifest
}

export async function readPortalOfflineDiskFile<T>(
  projectDirectory: string,
  file: Exclude<OfflineCacheFileName, "manifest.json">,
) {
  return readJsonFile<T>(cacheFilePath(projectDirectory, file))
}

export async function readPortalOfflineDiskBundle(
  projectDirectory: string,
): Promise<PortalOfflineDiskBundle | undefined> {
  const manifest = await readPortalOfflineDiskManifest(projectDirectory)
  if (!manifest) return undefined

  const bundle: PortalOfflineDiskBundle = {
    v: PORTAL_OFFLINE_DISK_CACHE_VERSION,
    savedAt: manifest.savedAt,
  }

  if (manifest.files.snapshot) {
    bundle.snapshot = await readPortalOfflineDiskFile(projectDirectory, "snapshot.json")
  }
  if (manifest.files.blog) {
    bundle.blog = await readPortalOfflineDiskFile(projectDirectory, "blog.json")
  }
  if (manifest.files.branding) {
    bundle.branding = await readPortalOfflineDiskFile(projectDirectory, "branding.json")
  }
  if (manifest.files.displayConfig) {
    bundle.displayConfig = await readPortalOfflineDiskFile(projectDirectory, "display-config.json")
  }
  if (manifest.files.teamStats) {
    bundle.teamStats = await readPortalOfflineDiskFile(projectDirectory, "team-stats.json")
  }
  if (manifest.files.skills) {
    bundle.skills = await readPortalOfflineDiskFile(projectDirectory, "skills.json")
  }

  return bundle
}

export async function buildPortalOfflineSkillsCache(
  projectDirectory: string,
  skills: PortalSkill[],
): Promise<PortalOfflineSkillsCache> {
  const bundle: PortalOfflineSkillsCache = {}
  for (const skill of skills) {
    const detail = await readSkillDetail(projectDirectory, skill.domain, skill.name)
    if (!detail) continue
    bundle[portalOfflineSkillCacheKey(skill.domain, skill.name)] = toBrowserSkillDetail(detail)
  }
  return bundle
}

export async function mergePortalOfflineDiskCache(
  projectDirectory: string,
  patch: PortalOfflineDiskPatch,
) {
  const prev = (await readPortalOfflineDiskBundle(projectDirectory)) ?? {
    v: PORTAL_OFFLINE_DISK_CACHE_VERSION,
    savedAt: new Date(0).toISOString(),
  }

  const next: PortalOfflineDiskBundle = {
    v: PORTAL_OFFLINE_DISK_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    snapshot: patch.snapshot ?? prev.snapshot,
    blog: patch.blog ?? prev.blog,
    branding: patch.branding ?? prev.branding,
    displayConfig: patch.displayConfig ?? prev.displayConfig,
    teamStats: patch.teamStats ?? prev.teamStats,
    skills: patch.skills ? { ...prev.skills, ...patch.skills } : prev.skills,
  }

  const files: PortalOfflineDiskManifest["files"] = {}
  if (next.snapshot) {
    await writeJsonFile(cacheFilePath(projectDirectory, "snapshot.json"), next.snapshot)
    files.snapshot = true
  }
  if (next.blog) {
    await writeJsonFile(cacheFilePath(projectDirectory, "blog.json"), next.blog)
    files.blog = true
  }
  if (next.branding) {
    await writeJsonFile(cacheFilePath(projectDirectory, "branding.json"), next.branding)
    files.branding = true
  }
  if (next.displayConfig) {
    await writeJsonFile(cacheFilePath(projectDirectory, "display-config.json"), next.displayConfig)
    files.displayConfig = true
  }
  if (next.teamStats) {
    await writeJsonFile(cacheFilePath(projectDirectory, "team-stats.json"), next.teamStats)
    files.teamStats = true
  }
  if (next.skills && Object.keys(next.skills).length > 0) {
    await writeJsonFile(cacheFilePath(projectDirectory, "skills.json"), next.skills)
    files.skills = true
  }

  const manifest: PortalOfflineDiskManifest = {
    v: PORTAL_OFFLINE_DISK_CACHE_VERSION,
    savedAt: next.savedAt,
    files,
  }
  await writeJsonFile(cacheFilePath(projectDirectory, "manifest.json"), manifest)
}

export async function refreshPortalOfflineSkillsCache(
  projectDirectory: string,
  skills: PortalSkill[],
) {
  const skillsCache = await buildPortalOfflineSkillsCache(projectDirectory, skills)
  if (Object.keys(skillsCache).length === 0) return
  await mergePortalOfflineDiskCache(projectDirectory, { skills: skillsCache })
}

export async function readPortalOfflineDiskSkillDetail(
  projectDirectory: string,
  domain: string,
  name: string,
) {
  const skills = await readPortalOfflineDiskFile<PortalOfflineSkillsCache>(
    projectDirectory,
    "skills.json",
  )
  return skills?.[portalOfflineSkillCacheKey(domain, name)]
}
