import Phaser from "phaser"
import type { PortalSnapshot } from "../api/types.ts"
import { onAgentSelectionCleared } from "../bridge/map-sidebar.ts"
import { setLiveAgentStatus } from "../portal/live-status.ts"
import { getPortalSnapshot } from "../portal/state.ts"
import type { AgentStatus } from "../office/dom-labels.ts"
import { getOfficeDomLabels, initOfficeDomLabels } from "../office/dom-labels.ts"
import { OfficeScene } from "../scenes/OfficeScene.ts"
import {
  beginOfficeLayoutReload,
  cancelOfficeLayoutReload,
  currentOfficeLayoutReloadToken,
  noteOfficeLayoutLoading,
  officeLayoutGenerationNeeded,
  officeLayoutManifestUrl,
  officeLayoutReloadInFlight,
  officeLayoutSettled,
  purgeOfficeLayoutCache,
  setOfficeRenovationOverlay,
  shouldReloadOfficeLayout,
} from "./layout-runtime.ts"
import { onViewChange } from "../shell/tabs.ts"
import { renderPortal } from "../shell/render-portal.ts"

let game: Phaser.Game | undefined
let resizeObserver: ResizeObserver | undefined
let officeHandlersBound = false
let officeLayoutReloadTimer: ReturnType<typeof setTimeout> | undefined
const OFFICE_LAYOUT_RELOAD_DEBOUNCE_MS = 800

export function getOfficeScene() {
  return game?.scene.getScene("OfficeScene") as OfficeScene | undefined
}

export function applyLiveAgentStatus(spawnId: string, status: AgentStatus) {
  setLiveAgentStatus(spawnId, status)
  getOfficeScene()?.setAgentStatus(spawnId, status)
}

export function handleAgentChatEvent(fromSpawnId: string, toSpawnId: string, text: string) {
  getOfficeScene()?.handleAgentChat(fromSpawnId, toSpawnId, text)
}

function officeView() {
  return document.getElementById("view-office")
}

function officeViewActive() {
  return officeView()?.classList.contains("active") === true
}

function officeGameMounted() {
  return officeView()?.classList.contains("office-phaser-alive") === true
}

function markOfficePhaserAlive() {
  officeView()?.classList.add("office-phaser-alive")
}

function officeGameTarget() {
  return document.getElementById("office-game-stack") ?? document.getElementById("office-game")
}

function officeGameParentSize(parent: HTMLElement) {
  const width = Math.floor(parent.clientWidth)
  const height = Math.floor(parent.clientHeight)
  if (width > 0 && height > 0) return { width, height }
  const rect = parent.getBoundingClientRect()
  const rectW = Math.floor(rect.width)
  const rectH = Math.floor(rect.height)
  if (rectW > 0 && rectH > 0) return { width: rectW, height: rectH }
  return { width: 0, height: 0 }
}

function refreshOfficeGameLayout(target: Phaser.Game, attempt = 0) {
  if (!officeGameMounted()) return

  const parent = officeGameTarget()
  if (!parent) return

  const size = officeGameParentSize(parent)
  if ((size.width <= 0 || size.height <= 0) && attempt < 12) {
    requestAnimationFrame(() => refreshOfficeGameLayout(target, attempt + 1))
    return
  }

  if (size.width > 0 && size.height > 0) target.scale.resize(size.width, size.height)
  target.scale.refresh()
  if (!officeViewActive()) return
  getOfficeDomLabels()?.syncLayout()
  const scene = target.scene.getScene("OfficeScene") as OfficeScene | undefined
  scene?.fitViewport()
  scene?.refreshTextResolution()
}

function scheduleOfficeGameRefresh(target: Phaser.Game) {
  requestAnimationFrame(() => refreshOfficeGameLayout(target))
}

function bindOfficeGameResize(target: Phaser.Game, observed: HTMLElement) {
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    if (!officeGameMounted()) return
    scheduleOfficeGameRefresh(target)
  })
  resizeObserver.observe(observed)
  const onViewportChange = () => {
    if (!officeGameMounted()) return
    scheduleOfficeGameRefresh(target)
  }
  window.addEventListener("resize", onViewportChange)
  window.visualViewport?.addEventListener("resize", onViewportChange)
  window.visualViewport?.addEventListener("scroll", onViewportChange)
}

function showOfficeGame(target: Phaser.Game) {
  target.loop.wake()
  target.scene.resume("OfficeScene")
  getOfficeDomLabels()?.setVisible(true)
  scheduleOfficeGameRefresh(target)
}

function hideOfficeGame(target: Phaser.Game) {
  target.loop.sleep()
  target.scene.pause("OfficeScene")
  getOfficeDomLabels()?.setVisible(false)
}

function destroyOfficeGame() {
  if (!game) return
  resizeObserver?.disconnect()
  resizeObserver = undefined
  game.destroy(true)
  game = undefined
  noteOfficeLayoutLoading(getPortalSnapshot()?.office_layout?.revision)
}

function createOfficeGame() {
  const stack = document.getElementById("office-game-stack")
  const parent = document.getElementById("office-game")
  if (!stack || !parent) return undefined

  markOfficePhaserAlive()

  const labels = initOfficeDomLabels(stack)
  const initial = officeGameParentSize(stack)
  const width = initial.width > 0 ? initial.width : 320
  const height = initial.height > 0 ? initial.height : 240

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width,
    height,
    backgroundColor: "#1a2218",
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      autoRound: true,
    },
    input: {
      mouse: {
        // Allow browser zoom (Ctrl+wheel) and page scroll over the canvas.
        preventDefaultWheel: false,
      },
    },
    scene: [OfficeScene],
  })

  labels.attach(game, () => (game?.scene.getScene("OfficeScene") as OfficeScene | undefined)?.cameras.main)

  if (!officeHandlersBound) {
    officeHandlersBound = true
    onAgentSelectionCleared(() => {
      getOfficeScene()?.clearAgentSelection()
    })
    onViewChange((view) => {
      if (!game) return
      if (view === "office") showOfficeGame(game)
      else hideOfficeGame(game)
    })
  }

  game.events.once("ready", () => {
    scheduleOfficeGameRefresh(game!)
  })

  bindOfficeGameResize(game, stack)
  if (officeViewActive()) showOfficeGame(game)
  return game
}

export function startOfficeGame() {
  if (game) {
    showOfficeGame(game)
    return game
  }
  return createOfficeGame()
}

function purgeOfficeLayoutCacheFromScene() {
  const scene = getOfficeScene()
  if (!scene) return
  purgeOfficeLayoutCache(scene)
}

export function officeLayoutReloadPending() {
  return officeLayoutReloadTimer !== undefined
}

export function prefetchOfficeLayoutGeneration(prev: PortalSnapshot | undefined, next: PortalSnapshot) {
  const generating = officeLayoutGenerationNeeded(prev, next)
  const reloading = officeLayoutReloadInFlight() || officeLayoutReloadPending()
  const staleScene = Boolean(next.office_layout?.ready && !officeLayoutSettled(next))
  if (generating || reloading || staleScene) {
    setOfficeRenovationOverlay(true)
    return
  }
  setOfficeRenovationOverlay(false)
}

function runOfficeLayoutReload() {
  const next = getPortalSnapshot()
  if (!next) return
  const scene = getOfficeScene()
  if (!game || !scene) return
  if (!shouldReloadOfficeLayout(undefined, next, scene.texturesReady)) return

  const revision = next.office_layout?.revision
  if (!revision) return

  const token = beginOfficeLayoutReload()
  void (async () => {
    const response = await fetch(officeLayoutManifestUrl(next), { signal: AbortSignal.timeout(120_000) }).catch(
      () => undefined,
    )
    if (token !== currentOfficeLayoutReloadToken()) return
    if (!response?.ok) {
      cancelOfficeLayoutReload(token)
      return
    }
    purgeOfficeLayoutCacheFromScene()
    destroyOfficeGame()
    if (token !== currentOfficeLayoutReloadToken()) return
    if (!createOfficeGame()) cancelOfficeLayoutReload(token)
  })().catch(() => {
    cancelOfficeLayoutReload(token)
  })
}

export function reloadOfficeLayoutIfNeeded(prev: PortalSnapshot | undefined, next: PortalSnapshot) {
  const scene = getOfficeScene()
  if (!game || !scene) return
  if (!shouldReloadOfficeLayout(prev, next, scene.texturesReady)) return

  if (officeLayoutReloadTimer) clearTimeout(officeLayoutReloadTimer)
  officeLayoutReloadTimer = setTimeout(() => {
    officeLayoutReloadTimer = undefined
    runOfficeLayoutReload()
  }, OFFICE_LAYOUT_RELOAD_DEBOUNCE_MS)
}

export function applyPortalSnapshot(snapshot: PortalSnapshot) {
  renderPortal(snapshot)
  const scene = game?.scene.getScene("OfficeScene") as OfficeScene | undefined
  scene?.applySnapshot(snapshot)
}

export function refreshOfficeSceneLocale() {
  const scene = game?.scene.getScene("OfficeScene") as OfficeScene | undefined
  scene?.refreshLocale()
}
