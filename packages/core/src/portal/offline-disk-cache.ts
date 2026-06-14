import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type { PortalBrandingResponse } from "./branding.ts"
import { buildBlogSnapshot } from "./blog.ts"
import { readBlogPublishedRevision } from "./blog-publish.ts"
import {
  type BrowserBlogSnapshot,
  type BrowserPortalSkillDetail,
  type BrowserPortalSnapshot,
  type BrowserTeamStatsSnapshot,
  toBrowserBlog,
  toBrowserSkillDetail,
} from "./browser-dto.ts"
import { portalOfflineCacheDir, portalStaticOfflineCacheDir } from "../paths.ts"
import { toBrowserDisplayConfig } from "./portal-display-settings.ts"
import { readSkillDetail, skillSourceMtimeMs } from "./skill.ts"
import type { PortalSkill } from "./snapshot.ts"

export const PORTAL_OFFLINE_DISK_CACHE_VERSION = 1

const DEFAULT_OFFLINE_CONTENT_TTL_MS = 5 * 60 * 1000
const OFFLINE_CONTENT_REFRESH_DEBOUNCE_MS = 2_000

export type BrowserPortalDisplayConfig = ReturnType<typeof toBrowserDisplayConfig>

export type PortalOfflineSkillsCache = Record<string, BrowserPortalSkillDetail>

export type PortalOfflineContentMeta = {
  refreshedAt: string
  blogRevision?: string
  skillFingerprints?: Record<string, number>
}

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
  content?: PortalOfflineContentMeta
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

export type RefreshPortalOfflineContentOptions = {
  force?: boolean
}

const scheduledContentRefresh = new Map<string, ReturnType<typeof setTimeout>>()
const inflightContentRefresh = new Map<string, Promise<void>>()
const latestScheduledSkills = new Map<string, PortalSkill[]>()
const scheduledStaticExport = new Map<string, ReturnType<typeof setTimeout>>()
const inflightStaticExport = new Map<string, Promise<void>>()

function envPositiveInt(key: string) {
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export function portalOfflineContentTtlMs() {
  return envPositiveInt("GATEHOUSE_PORTAL_OFFLINE_CONTENT_TTL_MS") ?? DEFAULT_OFFLINE_CONTENT_TTL_MS
}

export function portalOfflineSkillCacheKey(domain: string, name: string) {
  return `${domain}/${name}`
}

function projectKey(projectDirectory: string) {
  return path.resolve(projectDirectory)
}

function cacheFilePath(projectDirectory: string, file: OfflineCacheFileName) {
  return path.join(portalOfflineCacheDir(projectDirectory), file)
}

export function portalStaticOfflineCacheExportDirs(projectDirectory: string) {
  const dirs = [portalStaticOfflineCacheDir(projectDirectory)]
  const envDir = process.env.GATEHOUSE_PORTAL_STATIC_CACHE_DIR?.trim()
  if (envDir) dirs.push(path.resolve(envDir))
  return [...new Set(dirs.map((dir) => path.resolve(dir)))]
}

export async function exportPortalOfflineStaticCache(projectDirectory: string) {
  const bundle = await readPortalOfflineDiskBundle(projectDirectory)
  if (!bundle?.snapshot) return

  for (const dir of portalStaticOfflineCacheExportDirs(projectDirectory)) {
    await writeJsonFile(path.join(dir, "bundle.json"), bundle)
  }
}

function schedulePortalOfflineStaticCacheExport(projectDirectory: string) {
  const key = projectKey(projectDirectory)
  const pending = scheduledStaticExport.get(key)
  if (pending) clearTimeout(pending)

  scheduledStaticExport.set(
    key,
    setTimeout(() => {
      scheduledStaticExport.delete(key)
      if (inflightStaticExport.has(key)) return

      const job = exportPortalOfflineStaticCache(projectDirectory)
        .catch((error) => {
          console.warn("[gatehouse/portal] static offline cache export failed:", error)
        })
        .finally(() => {
          inflightStaticExport.delete(key)
        })
      inflightStaticExport.set(key, job)
    }, 500),
  )
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
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await Bun.write(tmp, JSON.stringify(data))
  await rename(tmp, filePath)
}

function skillIndex(skills: PortalSkill[]) {
  return skills
    .map((skill) => portalOfflineSkillCacheKey(skill.domain, skill.name))
    .sort()
    .join("\n")
}

function skillsComplete(bundle: PortalOfflineDiskBundle | undefined, skills: PortalSkill[]) {
  if (skills.length === 0) return true
  const cached = bundle?.skills ?? {}
  return skills.every((skill) => cached[portalOfflineSkillCacheKey(skill.domain, skill.name)]?.markdown)
}

async function mergeSkillCacheIncremental(
  projectDirectory: string,
  skills: PortalSkill[],
  prevSkills: PortalOfflineSkillsCache | undefined,
  prevFingerprints: Record<string, number> | undefined,
  force = false,
) {
  const nextSkills: PortalOfflineSkillsCache = { ...prevSkills }
  const nextFingerprints: Record<string, number> = { ...prevFingerprints }
  const validKeys = new Set(skills.map((skill) => portalOfflineSkillCacheKey(skill.domain, skill.name)))
  let changed = false

  for (const skill of skills) {
    const key = portalOfflineSkillCacheKey(skill.domain, skill.name)
    const mtimeMs = await skillSourceMtimeMs(projectDirectory, skill.domain, skill.name)
    if (mtimeMs === undefined) {
      if (key in nextSkills) {
        delete nextSkills[key]
        delete nextFingerprints[key]
        changed = true
      }
      continue
    }
    if (!force && nextFingerprints[key] === mtimeMs && nextSkills[key]?.markdown) continue

    const detail = await readSkillDetail(projectDirectory, skill.domain, skill.name)
    if (!detail) {
      if (key in nextSkills) {
        delete nextSkills[key]
        delete nextFingerprints[key]
        changed = true
      }
      continue
    }
    nextSkills[key] = toBrowserSkillDetail(detail)
    nextFingerprints[key] = mtimeMs
    changed = true
  }

  for (const key of Object.keys(nextSkills)) {
    if (validKeys.has(key)) continue
    delete nextSkills[key]
    delete nextFingerprints[key]
    changed = true
  }

  return { skills: nextSkills, fingerprints: nextFingerprints, changed }
}

async function writePortalOfflineManifest(
  projectDirectory: string,
  files: PortalOfflineDiskManifest["files"],
  content?: PortalOfflineContentMeta,
) {
  const manifest: PortalOfflineDiskManifest = {
    v: PORTAL_OFFLINE_DISK_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    files,
    ...(content && { content }),
  }
  await writeJsonFile(cacheFilePath(projectDirectory, "manifest.json"), manifest)
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

/** @deprecated Prefer mergeSkillCacheIncremental — kept for tests. */
export async function buildPortalOfflineSkillsCache(
  projectDirectory: string,
  skills: PortalSkill[],
): Promise<PortalOfflineSkillsCache> {
  const { skills: merged } = await mergeSkillCacheIncremental(projectDirectory, skills, undefined, undefined)
  return merged
}

export async function mergePortalOfflineDiskCache(
  projectDirectory: string,
  patch: PortalOfflineDiskPatch,
) {
  const prevManifest = await readPortalOfflineDiskManifest(projectDirectory)
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

  await writePortalOfflineManifest(projectDirectory, files, prevManifest?.content)
  schedulePortalOfflineStaticCacheExport(projectDirectory)
}

export async function refreshPortalOfflineSkillsCache(
  projectDirectory: string,
  skills: PortalSkill[],
) {
  await refreshPortalOfflineContentCache(projectDirectory, skills)
}

export async function refreshPortalOfflineContentCache(
  projectDirectory: string,
  skills: PortalSkill[],
  options: RefreshPortalOfflineContentOptions = {},
) {
  const force = options.force === true
  const manifest = await readPortalOfflineDiskManifest(projectDirectory)
  const bundle = await readPortalOfflineDiskBundle(projectDirectory)
  const blogRevision = await readBlogPublishedRevision(projectDirectory)
  const meta = manifest?.content
  const ttlMs = portalOfflineContentTtlMs()
  const refreshedAt = meta?.refreshedAt ? Date.parse(meta.refreshedAt) : 0
  const withinTtl = refreshedAt > 0 && Date.now() - refreshedAt < ttlMs
  const blogRevisionChanged = meta?.blogRevision !== blogRevision
  const needsBlog = force ? !bundle?.blog || blogRevisionChanged : !bundle?.blog || blogRevisionChanged
  const needsSkills = force
    ? skills.length > 0 && !skillsComplete(bundle, skills)
    : skills.length > 0 && !skillsComplete(bundle, skills)

  const skillMerge = await mergeSkillCacheIncremental(
    projectDirectory,
    skills,
    bundle?.skills,
    meta?.skillFingerprints,
    force,
  )

  if (
    !force &&
    withinTtl &&
    !needsBlog &&
    !needsSkills &&
    !blogRevisionChanged &&
    !skillMerge.changed
  ) {
    return
  }

  const patch: PortalOfflineDiskPatch = {}
  if (needsBlog || blogRevisionChanged) {
    const blogSnapshot = await buildBlogSnapshot(projectDirectory).catch(() => undefined)
    if (blogSnapshot) patch.blog = toBrowserBlog(projectDirectory, blogSnapshot)
  }
  if (skillMerge.changed || needsSkills) {
    patch.skills = skillMerge.skills
  }
  if (Object.keys(patch).length === 0 && !skillMerge.changed) return

  await mergePortalOfflineDiskCache(projectDirectory, patch)

  const files = (await readPortalOfflineDiskManifest(projectDirectory))?.files ?? manifest?.files ?? {}
  await writePortalOfflineManifest(projectDirectory, files, {
    refreshedAt: new Date().toISOString(),
    blogRevision,
    skillFingerprints: skillMerge.fingerprints,
  })
  schedulePortalOfflineStaticCacheExport(projectDirectory)
}

export function schedulePortalOfflineContentRefresh(projectDirectory: string, skills: PortalSkill[]) {
  const key = projectKey(projectDirectory)
  latestScheduledSkills.set(key, skills)

  const pending = scheduledContentRefresh.get(key)
  if (pending) clearTimeout(pending)

  scheduledContentRefresh.set(
    key,
    setTimeout(() => {
      scheduledContentRefresh.delete(key)
      if (inflightContentRefresh.has(key)) return

      const nextSkills = latestScheduledSkills.get(key) ?? skills
      const job = refreshPortalOfflineContentCache(projectDirectory, nextSkills)
        .catch((error) => {
          console.warn("[gatehouse/portal] offline content refresh failed:", error)
        })
        .finally(() => {
          inflightContentRefresh.delete(key)
        })
      inflightContentRefresh.set(key, job)
    }, OFFLINE_CONTENT_REFRESH_DEBOUNCE_MS),
  )
}

export async function flushPortalOfflineContentRefreshForTests(
  projectDirectory: string,
  skills: PortalSkill[],
) {
  const key = projectKey(projectDirectory)
  const pending = scheduledContentRefresh.get(key)
  if (pending) clearTimeout(pending)
  scheduledContentRefresh.delete(key)
  latestScheduledSkills.delete(key)
  await inflightContentRefresh.get(key)
  inflightContentRefresh.delete(key)
  await refreshPortalOfflineContentCache(projectDirectory, skills, { force: true })
}

export function clearPortalOfflineRefreshStateForTests() {
  for (const timer of scheduledContentRefresh.values()) clearTimeout(timer)
  scheduledContentRefresh.clear()
  inflightContentRefresh.clear()
  latestScheduledSkills.clear()
  for (const timer of scheduledStaticExport.values()) clearTimeout(timer)
  scheduledStaticExport.clear()
  inflightStaticExport.clear()
}

export async function ensurePortalOfflineDiskContent(
  projectDirectory: string,
  snapshot: BrowserPortalSnapshot,
) {
  const bundle = await readPortalOfflineDiskBundle(projectDirectory)
  const skills = snapshot.skills ?? []
  const needsBlog = !bundle?.blog
  const needsSkills = skills.length > 0 && !skillsComplete(bundle, skills)

  await refreshPortalOfflineContentCache(projectDirectory, skills, {
    force: needsBlog || needsSkills,
  })

  return (await readPortalOfflineDiskBundle(projectDirectory)) ?? bundle
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
