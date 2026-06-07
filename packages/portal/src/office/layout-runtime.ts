import type Phaser from "phaser"
import type { PortalSnapshot } from "../api/types.ts"
import { getPortalSnapshot } from "../portal/state.ts"
import { layoutDecorTextureKey } from "../scenes/office-layout-decor.ts"

let officeSceneLayoutRevision: string | undefined
let officeLayoutLoadingRevision: string | undefined
let officeLayoutReloading = false
let officeLayoutReloadToken = 0

const OFFICE_DECOR_TEXTURES = [
  "boss_desk_tl.png",
  "boss_desk_tr.png",
  "boss_desk_dl.png",
  "boss_desk_dr.png",
  "boss_front_wall.png",
  "chair_back.png",
  "chair_front.png",
  "office_desk_left.png",
  "office_desk_right_0.png",
  "office_desk_right_1.png",
  "office_desk_right_2.png",
  "office_desk_right_3.png",
] as const

export function noteOfficeLayoutLoaded(revision: string) {
  officeSceneLayoutRevision = revision
  officeLayoutLoadingRevision = undefined
}

export function noteOfficeLayoutLoading(revision: string | undefined) {
  officeLayoutLoadingRevision = revision
}

export function officeLayoutReloadInFlight() {
  return officeLayoutReloading
}

export function currentOfficeLayoutReloadToken() {
  return officeLayoutReloadToken
}

export function officeLayoutGenerationNeeded(prev: PortalSnapshot | undefined, next: PortalSnapshot) {
  const layout = next.office_layout
  if (!layout?.revision || layout.ready) return false
  const before = prev?.office_layout
  if (!before) return true
  return before.revision !== layout.revision || !before.ready
}

export function officeLayoutRevisionChanged(prev: PortalSnapshot | undefined, next: PortalSnapshot) {
  const layout = next.office_layout
  if (!layout?.revision || !layout.ready) return false
  const before = prev?.office_layout
  if (!before) return true
  return before.revision !== layout.revision || !before.ready
}

export function officeLayoutSettled(snapshot: PortalSnapshot) {
  const layout = snapshot.office_layout
  if (!layout?.revision || !layout.ready) return false
  return officeSceneLayoutRevision === layout.revision
}

export function shouldReloadOfficeLayout(
  prev: PortalSnapshot | undefined,
  next: PortalSnapshot,
  texturesReady: boolean,
) {
  const layout = next.office_layout
  if (!layout?.revision || !layout.ready) return false
  if (officeLayoutReloading) return false
  if (texturesReady && officeSceneLayoutRevision === layout.revision) return false
  if (!texturesReady && officeLayoutLoadingRevision === layout.revision) return false
  if (officeSceneLayoutRevision !== layout.revision) return true
  return officeLayoutRevisionChanged(prev, next)
}

export function setOfficeRenovationOverlay(visible: boolean) {
  const overlay = document.getElementById("office-renovation-overlay")
  if (!overlay) return
  overlay.hidden = !visible
}

export function purgeOfficeLayoutCache(scene: Phaser.Scene) {
  const manifest = scene.cache.json.get("office-layout-manifest") as { decorObjects?: { texture: string }[] } | undefined
  for (const entry of manifest?.decorObjects ?? []) {
    const key = layoutDecorTextureKey(entry.texture)
    if (scene.textures.exists(key)) scene.textures.remove(key)
  }
  for (const key of officeLayoutCacheKeys()) {
    if (scene.cache.json.exists(key)) scene.cache.json.remove(key)
    if (scene.cache.tilemap.exists(key)) scene.cache.tilemap.remove(key)
    if (scene.textures.exists(key)) scene.textures.remove(key)
  }
}

export function beginOfficeLayoutReload() {
  officeLayoutReloadToken++
  officeLayoutReloading = true
  officeSceneLayoutRevision = undefined
  officeLayoutLoadingRevision = undefined
  setOfficeRenovationOverlay(true)
  return officeLayoutReloadToken
}

export function endOfficeLayoutReload(revision: string, token?: number) {
  if (officeLayoutReloading) {
    if (token === undefined || token !== officeLayoutReloadToken) return
  }
  noteOfficeLayoutLoaded(revision)
  officeLayoutReloading = false
  setOfficeRenovationOverlay(false)
}

export function cancelOfficeLayoutReload(token?: number) {
  if (token !== undefined && token !== officeLayoutReloadToken) return
  officeLayoutReloading = false
  if (getPortalSnapshot()?.office_layout?.ready) {
    setOfficeRenovationOverlay(false)
  }
}

export function resetOfficeLayoutRuntimeForTests() {
  officeSceneLayoutRevision = undefined
  officeLayoutLoadingRevision = undefined
  officeLayoutReloading = false
  officeLayoutReloadToken = 0
  setOfficeRenovationOverlay(false)
}

export function officeLayoutManifestUrl(snapshot: PortalSnapshot) {
  const params = new URLSearchParams()
  if (snapshot.project) params.set("project", snapshot.project)
  const revision = snapshot.office_layout?.revision
  if (revision) params.set("revision", revision)
  return `/portal/api/office/manifest.json?${params}`
}

export function officeLayoutCacheKeys() {
  return [
    "office-layout-manifest",
    "office-layout",
    "office-scene-bg",
    "office-collision-tiles",
    ...OFFICE_DECOR_TEXTURES.map((file) => `office-decor-${file}`),
  ]
}
