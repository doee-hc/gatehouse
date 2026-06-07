import Phaser from "phaser"
import { officeAgentsFromSnapshot, type PortalSnapshot } from "../api/types.ts"
import { emitAgentSelectedFromMap } from "../bridge/map-sidebar.ts"
import { refreshAgentOverlayIfOpen } from "../shell/agent-overlay.ts"
import { behaviorForAgent, type BehaviorKind } from "../office/behaviors.ts"
import type { CharacterAtlasPrefix } from "../office/characters.ts"
import {
  agentLabelAnchorsFromMatrix,
  CHAT_BUBBLE_MS,
  getOfficeDomLabels,
  type AgentStatus,
} from "../office/dom-labels.ts"
import {
  facingFromGridDelta,
  facingFromVelocity,
  characterAnimKey,
  characterSpriteFrame,
  registerCharacterAnims,
  type Facing,
} from "../office/character-anims.ts"
import {
  CHARACTER_SHEET_ROLES,
  characterSheetAtlasPaths,
  characterSheetTextureKey,
} from "../office/character-sheets.ts"
import { setOfficeTileSize } from "../office/office-tile-size.ts"
import { IDLE_WANDER_ENABLED } from "../portal/office-behavior.ts"
import { resolveAgentDisplayStatus } from "../portal/live-status.ts"
import { getPortalSnapshot } from "../portal/state.ts"
import { findPath, type GridPoint } from "../pathfinding/astar.ts"
import { gridCenter, gridPathToWorldWaypoints, worldToGrid, type WorldPoint } from "../pathfinding/path-move.ts"
import { PHASER_FONT, phaserTextResolution, t } from "../shell/i18n.ts"
import { switchView } from "../shell/tabs.ts"
import { showToast } from "../shell/toast.ts"
import {
  agentShouldSitAtDesk,
  anchorGridKey,
  occupiedAnchorKeys,
  pickAnchorForAgent,
  pickWanderTarget,
  readDeskAnchors,
  workspaceAnchorAt,
  type DeskAnchor,
} from "./office-anchors.ts"
import {
  depthForBossChairStanding,
  depthForSeatedChair,
  depthForSeatedAgent,
  depthForInnerChairStanding,
  agentSitWorld,
  readChairSpots,
  type ChairSpot,
} from "./office-chairs.ts"
import { layoutDecorTextureKey, spawnLayoutDecor } from "./office-layout-decor.ts"
import {
  cancelOfficeLayoutReload,
  currentOfficeLayoutReloadToken,
  endOfficeLayoutReload,
  noteOfficeLayoutLoading,
  officeLayoutReloadInFlight,
  purgeOfficeLayoutCache,
} from "../office/layout-runtime.ts"
import { retroFollowGrid } from "./meeting-room.ts"
import { tiledObjectProp } from "./tiled-props.ts"

const RETRO_GHOST_ALPHA = 0.48

function sitSpriteOrigin(facing: Facing) {
  if (facing === "down") return { x: 0.5, y: 0.92 }
  if (facing === "up") return { x: 0.5, y: 0.88 }
  return { x: 0.5, y: 0.85 }
}

type AgentDef = {
  id: string
  name: string
  atlasPrefix: CharacterAtlasPrefix
  status: AgentStatus
  fixed?: boolean
  ghost?: boolean
  scope?: PortalSnapshot["agents"][number]["scope"]
  missionId?: string
  nodeId?: string
}

type OfficeLayoutManifest = {
  version: number
  mapKey: string
  mode: "scene-bg"
  sceneBgKey: string
  tileSize: number
  sceneBackgroundColor?: string
  revision?: string
  bossLayered?: boolean
  decorObjects?: { texture: string; file: string }[]
}

function officeLayoutQuery() {
  const snapshot = getPortalSnapshot()
  const params = new URLSearchParams()
  if (snapshot?.project) params.set("project", snapshot.project)
  if (snapshot?.office_layout?.revision) params.set("revision", snapshot.office_layout.revision)
  const query = params.toString()
  return query ? `?${query}` : ""
}

const WALK_SPEED_PX_PER_SEC = 120
const WANDER_INTERVAL_MS = 8000
const CHAT_CHASE_REPATH_MS = 250
const CHAT_CHASE_MAX_MS = 15000

type ChatChaseState = {
  toSpawnId: string
  onArrived: () => void
  lastReceiverGrid?: GridPoint
  lastRepathAt: number
  startedAt: number
}
const AGENT_DEPTH_BASE = 10
/**
 * Per-role `sheets/{role}-1x1` frame + `setOrigin(0.5, 0.85)` on the child sprite.
 * Hit rect is in Container local space at (0,0) = sprite anchor (feet).
 * Do not call `setSize` on the Container: with a size, Phaser aligns hit areas to the
 * bounds top-left, not (0,0), which shifts the box ~half width left of the sprite.
 */
const AGENT_SPRITE_W = 32
const AGENT_SPRITE_H = 64
const AGENT_SPRITE_ORIGIN_Y = 0.85
const AGENT_HIT_PAD = 4
const AGENT_HIT_ABOVE = Math.round(AGENT_SPRITE_H * AGENT_SPRITE_ORIGIN_Y) + AGENT_HIT_PAD
const AGENT_HIT_BELOW = Math.round(AGENT_SPRITE_H * (1 - AGENT_SPRITE_ORIGIN_Y)) + AGENT_HIT_PAD
const AGENT_HIT_RECT = new Phaser.Geom.Rectangle(
  -(AGENT_SPRITE_W / 2 + AGENT_HIT_PAD),
  -AGENT_HIT_ABOVE,
  AGENT_SPRITE_W + AGENT_HIT_PAD * 2,
  AGENT_HIT_ABOVE + AGENT_HIT_BELOW,
)
const BLOCKED_TILE_INDEX = 2

function officeTextStyle(style: Phaser.Types.GameObjects.Text.TextStyle) {
  return {
    fontFamily: PHASER_FONT,
    resolution: phaserTextResolution(),
    ...style,
  }
}

class Agent extends Phaser.GameObjects.Container {
  agentId: string
  displayName: string
  grid: GridPoint
  pathWorld: WorldPoint[] = []
  walkSpeed = WALK_SPEED_PX_PER_SEC
  selected = false
  agentStatus: AgentStatus
  sprite: Phaser.GameObjects.Sprite
  atlasPrefix: CharacterAtlasPrefix
  behavior: BehaviorKind = "stand"
  facing: Facing = "down"
  pathDone?: () => void
  pathIntent?: "chat"
  seatedChairId?: string
  pendingSitChairId?: string
  ghost = false

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    def: AgentDef,
    grid: GridPoint,
  ) {
    super(scene, x, y)
    this.agentId = def.id
    this.displayName = def.name
    this.agentStatus = def.status
    this.grid = grid
    this.atlasPrefix = def.atlasPrefix
    this.ghost = def.ghost === true

    const surface = characterSpriteFrame(scene, def.atlasPrefix, "stand", "down", false)
    this.sprite = scene.make
      .sprite({ x: 0, y: 0, key: surface.textureKey, frame: surface.frame, add: false })
      .setOrigin(0.5, 0.85)
    if (this.ghost) this.sprite.setAlpha(RETRO_GHOST_ALPHA)
    this.add(this.sprite)
    this.setInteractive(AGENT_HIT_RECT, Phaser.Geom.Rectangle.Contains)
    this.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation()
      ;(this.scene as OfficeScene).selectAgent(this.agentId, pointerClientX(pointer))
    })
    scene.add.existing(this)
    this.syncDepth()
    this.syncBehavior()
  }

  syncDepth() {
    const scene = this.scene as OfficeScene
    if (this.seatedChairId) {
      const chair = scene.chairs.get(this.seatedChairId)
      if (chair) {
        this.setDepth(depthForSeatedAgent(chair, this.y))
        return
      }
    }
    this.setDepth(AGENT_DEPTH_BASE + this.y)
  }

  clearSeat() {
    if (!this.seatedChairId) return
    const scene = this.scene as OfficeScene
    scene.restoreChairDepth(this.seatedChairId)
    this.seatedChairId = undefined
  }

  get isMoving() {
    return this.pathWorld.length > 0
  }

  setSelected(value: boolean) {
    this.selected = value
    this.sprite.setTint(value ? 0xfff3b0 : 0xffffff)
    if (this.ghost) this.sprite.setAlpha(value ? 0.62 : RETRO_GHOST_ALPHA)
  }

  setStatus(status: AgentStatus) {
    this.agentStatus = status
    this.syncBehavior()
  }

  syncBehavior() {
    const scene = this.scene as OfficeScene
    if (this.seatedChairId) {
      const chair = scene.chairs.get(this.seatedChairId)
      if (chair) {
        this.facing = chair.sitDirection
        if (this.behavior !== "sit") {
          this.behavior = "sit"
          this.applyBehaviorVisual()
        }
        return
      }
    }
    const next = behaviorForAgent({
      status: this.agentStatus,
      isMoving: this.isMoving,
      agentId: this.agentId,
      idleContext: scene.idleBehaviorContext(this.agentId, this.grid),
    })
    if (next === this.behavior) {
      if (!this.isMoving) return
      const animKey = characterAnimKey(this.atlasPrefix, next, this.facing, true)
      if (this.scene.anims.exists(animKey) && this.sprite.anims.currentAnim?.key === animKey) return
    }
    this.behavior = next
    this.applyBehaviorVisual()
  }

  applyBehaviorVisual() {
    const origin = this.behavior === "sit" ? sitSpriteOrigin(this.facing) : { x: 0.5, y: 0.85 }
    this.sprite.setOrigin(origin.x, origin.y)
    const animKey = characterAnimKey(
      this.atlasPrefix,
      this.behavior,
      this.facing,
      this.isMoving,
    )
    if (this.scene.anims.exists(animKey)) {
      if (this.sprite.anims.currentAnim?.key !== animKey) this.sprite.play(animKey)
      return
    }
    const surface = characterSpriteFrame(this.scene, this.atlasPrefix, this.behavior, this.facing, this.isMoving)
    this.sprite.setTexture(surface.textureKey, surface.frame)
    this.sprite.anims.stop()
  }

  walkTo(grid: GridPoint, blocked: boolean[][], sitChairId?: string) {
    const scene = this.scene as OfficeScene
    this.clearSeat()
    this.pendingSitChairId = sitChairId
    this.pathDone = undefined
    this.pathIntent = undefined
    const chair = sitChairId ? scene.chairs.get(sitChairId) : undefined
    const path = findPath(blocked, this.grid, grid)
    if (path.length <= 1) {
      if (chair) {
        this.setPosition(agentSitWorld(chair).x, agentSitWorld(chair).y)
        this.grid = chair.sitGrid
        scene.applySit(this, chair)
        return
      }
      scene.onAgentPathEnd(this)
      return
    }
    this.pathWorld = gridPathToWorldWaypoints(path, chair ? agentSitWorld(chair) : undefined)
    this.pathIntent = undefined
    this.syncBehavior()
  }

  walkToThen(grid: GridPoint, blocked: boolean[][], onDone: () => void) {
    this.clearSeat()
    this.pendingSitChairId = undefined
    this.pathIntent = "chat"
    const path = findPath(blocked, this.grid, grid)
    if (path.length <= 1) {
      onDone()
      return
    }
    this.pathWorld = gridPathToWorldWaypoints(path)
    this.pathDone = onDone
    this.syncBehavior()
  }

  /** Repath during chat chase; returns true when already at the destination grid. */
  setChatPath(grid: GridPoint, blocked: boolean[][]) {
    this.pathIntent = "chat"
    const path = findPath(blocked, this.grid, grid)
    if (path.length <= 1) {
      this.pathWorld = []
      return true
    }
    this.pathWorld = gridPathToWorldWaypoints(path)
    this.syncBehavior()
    return false
  }

  finishPath() {
    const intent = this.pathIntent
    this.pathDone?.()
    this.pathDone = undefined
    if (intent !== "chat") this.pathIntent = undefined
  }

  updateAgent(_time: number, delta: number) {
    const scene = this.scene as OfficeScene
    if (this.pathIntent === "chat" && scene.tryCompleteChatChaseIfAdjacent(this.agentId)) {
      this.syncBehavior()
      return
    }

    if (this.pathWorld.length === 0) {
      this.syncBehavior()
      return
    }

    const target = this.pathWorld[0]!
    const dx = target.x - this.x
    const dy = target.y - this.y
    const dist = Math.hypot(dx, dy)
    const step = (this.walkSpeed * delta) / 1000

    if (dist <= step || dist === 0) {
      this.setPosition(target.x, target.y)
      this.grid = worldToGrid(target.x, target.y)
      this.pathWorld.shift()
      if (this.pathWorld.length === 0) {
        this.finishPath()
        ;(this.scene as OfficeScene).onAgentPathEnd(this)
      }
      this.syncDepth()
      this.syncBehavior()
      return
    }

    this.setPosition(this.x + (dx / dist) * step, this.y + (dy / dist) * step)
    this.grid = worldToGrid(this.x, this.y)
    this.facing = facingFromVelocity(dx, dy, this.facing)
    this.syncDepth()
    this.syncBehavior()
  }
}

export class OfficeScene extends Phaser.Scene {
  texturesReady = false
  agents = new Map<string, Agent>()
  selectedId = ""
  blocked: boolean[][] = []
  mapWidth = 0
  mapHeight = 0
  tiledSpawns = new Map<string, GridPoint>()
  deskAnchors: DeskAnchor[] = []
  chairs = new Map<string, ChairSpot>()
  decorSprites = new Map<string, Phaser.GameObjects.Sprite>()
  manifest?: OfficeLayoutManifest
  tileSize = 32
  layoutRevision?: string
  wanderTicks = new Map<string, number>()
  chatQueues = new Map<string, { toSpawnId: string; text: string }[]>()
  chatInFlight = new Set<string>()
  chatHomeGrid = new Map<string, GridPoint>()
  chatChaseTargets = new Map<string, ChatChaseState>()
  retroFollowArchitectGrid?: GridPoint

  constructor() {
    super("OfficeScene")
  }

  preload() {
    if (this.load.isLoading()) this.load.reset()
    noteOfficeLayoutLoading(getPortalSnapshot()?.office_layout?.revision)
    this.load.once("loaderror", () => {
      if (!officeLayoutReloadInFlight()) return
      cancelOfficeLayoutReload(currentOfficeLayoutReloadToken())
    })

    const layoutQuery = officeLayoutQuery()
    this.load.json("office-layout-manifest", `/portal/api/office/manifest.json${layoutQuery}`)
    this.load.tilemapTiledJSON("office-layout", `/portal/api/office/map.json${layoutQuery}`)
    this.load.image("office-scene-bg", `/portal/api/office/scene-bg.png${layoutQuery}`)
    this.load.image("office-collision-tiles", `/portal/api/office/collision-tile.png${layoutQuery}`)
    for (const file of [
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
    ]) {
      this.load.image(layoutDecorTextureKey(file), `/portal/api/office/assets/objects/${file}${layoutQuery}`)
    }

    for (const role of CHARACTER_SHEET_ROLES) {
      const paths = characterSheetAtlasPaths(role)
      this.load.atlas(characterSheetTextureKey(role), paths.png, paths.json)
    }
  }

  create() {
    const layoutManifest = this.cache.json.get("office-layout-manifest") as OfficeLayoutManifest | undefined
    if (layoutManifest?.version !== 1 || !this.textures.exists("office-scene-bg") || !this.cache.tilemap.has("office-layout")) {
      if (officeLayoutReloadInFlight()) cancelOfficeLayoutReload(currentOfficeLayoutReloadToken())
      this.add
        .text(
          16,
          16,
          "Office layout unavailable. Bootstrap a mission or run: bun run import:office-layout",
          officeTextStyle({
            fontSize: "14px",
            color: "#ffffff",
            backgroundColor: "#991b1b",
            padding: { x: 8, y: 8 },
          }),
        )
        .setDepth(100)
      return
    }

    this.manifest = { ...layoutManifest, mapKey: "office-layout", sceneBgKey: "office-scene-bg" }
    this.layoutRevision = layoutManifest.revision
    const revision = layoutManifest.revision ?? getPortalSnapshot()?.office_layout?.revision
    if (revision) endOfficeLayoutReload(revision, currentOfficeLayoutReloadToken())
    this.bootstrapOfficeScene()
  }

  shutdown() {
    purgeOfficeLayoutCache(this)
    this.agents.clear()
    this.chatQueues.clear()
    this.decorSprites.clear()
    this.chairs.clear()
    this.tiledSpawns.clear()
    this.texturesReady = false
  }

  bootstrapOfficeScene() {
    const manifest = this.manifest
    if (!manifest) return

    if (manifest.sceneBackgroundColor) this.cameras.main.setBackgroundColor(manifest.sceneBackgroundColor)
    this.tileSize = manifest.tileSize
    setOfficeTileSize(this.tileSize)
    const map = this.make.tilemap({ key: manifest.mapKey })
    this.mapWidth = map.width
    this.mapHeight = map.height

    this.add.image(0, 0, manifest.sceneBgKey).setOrigin(0, 0).setDepth(0)
    if (this.textures.exists(manifest.sceneBgKey)) {
      this.textures.get(manifest.sceneBgKey).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    for (const role of CHARACTER_SHEET_ROLES) {
      const key = characterSheetTextureKey(role)
      if (this.textures.exists(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    if (manifest.bossLayered) {
      for (const file of [
        "boss_desk_tl.png",
        "boss_desk_tr.png",
        "boss_desk_dl.png",
        "boss_desk_dr.png",
        "boss_front_wall.png",
        "chair_back.png",
        "chair_front.png",
      ]) {
        const key = layoutDecorTextureKey(file)
        if (this.textures.exists(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
    }

    const collisionTileset = map.addTilesetImage("collision-tiles", "office-collision-tiles")
    if (collisionTileset) {
      map.createLayer("collision", collisionTileset, 0, 0)?.setVisible(false)
    }

    this.chairs = readChairSpots(map)
    if (manifest.bossLayered) spawnLayoutDecor(this, map, this.decorSprites)
    this.blocked = this.readCollision(map)
    this.deskAnchors = readDeskAnchors(map)
    for (const anchor of this.deskAnchors) {
      if (!anchor.chairId?.startsWith("inner-")) continue
      const chair = this.chairs.get(anchor.chairId)
      if (!chair) continue
      anchor.grid = chair.sitGrid
    }

    const spawnLayer = map.getObjectLayer("spawns")
    spawnLayer?.objects
      .filter((obj) => obj.type === "agent")
      .forEach((obj) => {
        const agentId = tiledObjectProp(obj, "agentId")
        if (typeof agentId !== "string") return
        this.tiledSpawns.set(agentId, {
          x: Math.floor(obj.x! / this.tileSize),
          y: Math.floor(obj.y! / this.tileSize),
        })
      })

    const emptySnapshot: PortalSnapshot = {
      project: "",
      updated_at: "",
      missions: [],
      agents: [],
      skills: [],
    }
    const prefixes = [...new Set(agentDefsFromSnapshot(getPortalSnapshot() ?? emptySnapshot).map((d) => d.atlasPrefix))]
    registerCharacterAnims(this, prefixes)

    this.texturesReady = true
    const snapshot = getPortalSnapshot()
    if (snapshot) this.syncFromSnapshot(snapshot)

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return
      const agent = this.agents.get(this.selectedId)
      if (!agent) return
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const grid = worldToGrid(world.x, world.y)
      if (grid.x < 0 || grid.y < 0 || grid.x >= this.mapWidth || grid.y >= this.mapHeight) return
      if (this.blocked[grid.y]?.[grid.x]) return
      agent.walkTo(grid, this.blocked)
    })

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
    this.cameras.main.setRoundPixels(true)
    this.add
      .graphics()
      .lineStyle(3, 0x3d4f5c, 1)
      .strokeRect(0.5, 0.5, map.widthInPixels - 1, map.heightInPixels - 1)
      .setDepth(1)
    this.fitViewport()
    this.syncDomLabels()
  }

  dedicatedChairForAgent(agentId: string) {
    const anchor = this.deskAnchors.find((entry) => entry.agentId === agentId && entry.chairId)
    if (!anchor?.chairId) return undefined
    return this.chairs.get(anchor.chairId)
  }

  boundWorkstationChair(agentId: string) {
    const snapshot = getPortalSnapshot()
    const record = snapshot?.agents.find((entry) => entry.spawn_id === agentId)
    if (record?.scope === "retro") return undefined
    const slot = snapshot?.office_layout?.bindings?.find((entry) => entry.spawn_id === agentId)?.slot
    if (slot === undefined) return undefined
    return this.chairs.get(`inner-${slot}`)
  }

  /** Inner agents beyond map workstation capacity have no slot binding and should wander. */
  isOverflowInnerAgent(agentId: string) {
    const record = getPortalSnapshot()?.agents.find((entry) => entry.spawn_id === agentId)
    if (record?.scope !== "inner") return false
    return this.boundWorkstationChair(agentId) === undefined
  }

  retroMeetingActive() {
    return getPortalSnapshot()?.retro?.active === true
  }

  retroSpawnIds(snapshot = getPortalSnapshot()) {
    return snapshot?.agents.filter((agent) => agent.scope === "retro").map((agent) => agent.spawn_id) ?? []
  }

  architectGridForRetroFollow() {
    const architect = this.agents.get("architect")
    if (architect) return { x: architect.grid.x, y: architect.grid.y }
    const anchor = this.deskAnchors.find((entry) => entry.agentId === "architect")
    if (anchor) return anchor.grid
    const spawn = this.tiledSpawns.get("architect")
    if (spawn) return spawn
    return { x: Math.floor(this.mapWidth / 2), y: Math.floor(this.mapHeight / 2) }
  }

  retroFollowGridForAgent(agentId: string) {
    const snapshot = getPortalSnapshot()
    if (!snapshot?.retro?.active) return undefined
    const record = snapshot.agents.find((agent) => agent.spawn_id === agentId)
    if (record?.scope !== "retro") return undefined
    return retroFollowGrid(
      record.spawn_id,
      this.retroSpawnIds(snapshot),
      this.architectGridForRetroFollow(),
      this.blocked,
      this.mapWidth,
      this.mapHeight,
    )
  }

  routeRetroAgentToArchitect(agent: Agent) {
    const grid = this.retroFollowGridForAgent(agent.agentId)
    if (!grid) return false
    if (agent.seatedChairId) agent.clearSeat()
    if (agent.grid.x === grid.x && agent.grid.y === grid.y && !agent.isMoving) return true
    agent.walkTo(grid, this.blocked)
    return true
  }

  routeAgentToBoundSeat(agent: Agent) {
    const chair = this.boundWorkstationChair(agent.agentId)
    if (!chair) return false
    if (agent.seatedChairId === chair.id) return true
    if (agent.isMoving && agent.pendingSitChairId === chair.id) return true

    const anchor = this.deskAnchors.find((entry) => entry.chairId === chair.id)
    const targetGrid = anchor?.grid ?? chair.sitGrid
    if (agent.grid.x === targetGrid.x && agent.grid.y === targetGrid.y && !agent.isMoving) {
      this.applySit(agent, chair)
      return true
    }
    agent.walkTo(targetGrid, this.blocked, chair.id)
    return true
  }

  routeAgentToDedicatedSeat(agent: Agent) {
    const chair = this.dedicatedChairForAgent(agent.agentId)
    if (!chair) return false
    if (agent.seatedChairId === chair.id) return true
    if (agent.isMoving && agent.pendingSitChairId === chair.id) return true

    const anchor = this.deskAnchors.find(
      (entry) => entry.agentId === agent.agentId && entry.chairId === chair.id,
    )
    const targetGrid = anchor?.grid ?? chair.sitGrid
    if (agent.grid.x === targetGrid.x && agent.grid.y === targetGrid.y && !agent.isMoving) {
      this.applySit(agent, chair)
      return true
    }
    agent.walkTo(targetGrid, this.blocked, chair.id)
    return true
  }

  routeAgentForStatus(agent: Agent, status: AgentStatus) {
    if (agent.pathIntent === "chat" || this.chatInFlight.has(agent.agentId)) return
    if ((this.chatQueues.get(agent.agentId)?.length ?? 0) > 0) return
    const record = getPortalSnapshot()?.agents.find((item) => item.spawn_id === agent.agentId)
    if (record?.scope === "retro") {
      this.routeRetroAgentToArchitect(agent)
      return
    }
    if (record?.scope === "outer") {
      if (status === "idle" && IDLE_WANDER_ENABLED) {
        agent.clearSeat()
        if (!agent.isMoving) this.resetWanderTimer(agent.agentId)
        return
      }
      this.routeAgentToDedicatedSeat(agent)
      return
    }
    if (this.boundWorkstationChair(agent.agentId)) {
      if (status === "idle" && IDLE_WANDER_ENABLED) {
        agent.clearSeat()
        if (!agent.isMoving) this.resetWanderTimer(agent.agentId)
        return
      }
      this.routeAgentToBoundSeat(agent)
      return
    }
    if (this.isOverflowInnerAgent(agent.agentId)) {
      agent.clearSeat()
      if (!agent.isMoving) this.resetWanderTimer(agent.agentId)
      return
    }
    if (agentShouldSitAtDesk(status)) this.routeAgentToWorkstation(agent)
    else agent.clearSeat()
  }

  fitViewport() {
    const cam = this.cameras.main
    const mapW = this.mapWidth * this.tileSize
    const mapH = this.mapHeight * this.tileSize
    if (!mapW || !mapH || !cam.width || !cam.height) return
    const zoom = Math.min(cam.width / mapW, cam.height / mapH)
    cam.setZoom(zoom)
    cam.centerOn(mapW / 2, mapH / 2)
    this.repositionDomLabels()
  }

  restoreChairDepth(chairId: string) {
    const chair = this.chairs.get(chairId)
    const sprite = this.decorSprites.get(chairId)
    if (!chair || !sprite) return
    if (chair.id.startsWith("inner-")) {
      sprite.setDepth(depthForInnerChairStanding(chair))
      return
    }
    sprite.setDepth(depthForBossChairStanding(chair))
  }

  applySit(agent: Agent, chair: ChairSpot) {
    agent.seatedChairId = chair.id
    agent.pendingSitChairId = undefined
    const sit = agentSitWorld(chair)
    agent.setPosition(sit.x, sit.y)
    agent.grid = chair.sitGrid
    agent.facing = chair.sitDirection
    agent.pathWorld = []
    const sprite = this.decorSprites.get(chair.id)
    if (sprite) sprite.setDepth(depthForSeatedChair(chair))
    agent.syncDepth()
    agent.behavior = "sit"
    agent.applyBehaviorVisual()
  }

  onAgentPathEnd(agent: Agent) {
    if (agent.pendingSitChairId) {
      const chair = this.chairs.get(agent.pendingSitChairId)
      agent.pendingSitChairId = undefined
      if (!chair) return
      this.applySit(agent, chair)
      return
    }
    this.resetWanderTimer(agent.agentId)
  }

  idleBehaviorContext(agentId: string, grid: GridPoint) {
    const anchor = workspaceAnchorAt(agentId, grid, this.deskAnchors)
    const agent = this.agents.get(agentId)
    const seated = agent?.seatedChairId !== undefined
    const atChair =
      seated || (anchor?.chairId !== undefined && this.chairs.has(anchor.chairId))
    return {
      atWorkspaceAnchor: anchor !== undefined,
      atChair,
      seated,
    }
  }

  routeAgentToWorkstation(agent: Agent, reserved = occupiedAnchorKeys(this.agents.values(), agent.agentId)) {
    if (!agentShouldSitAtDesk(agent.agentStatus)) return
    if (agent.pathIntent === "chat") return
    const target = pickAnchorForAgent(agent.agentId, agent.grid, agent.agentStatus, this.deskAnchors, reserved)
    if (!target) return
    const anchor = this.deskAnchors.find(
      (entry) => entry.grid.x === target.x && entry.grid.y === target.y,
    )
    const sitChairId = anchor?.chairId
    if (target.x === agent.grid.x && target.y === agent.grid.y) {
      if (sitChairId) {
        const chair = this.chairs.get(sitChairId)
        if (chair) this.applySit(agent, chair)
      }
      return
    }
    reserved.add(anchorGridKey(target))
    agent.walkTo(target, this.blocked, sitChairId)
  }

  resetWanderTimer(agentId: string, now = this.time.now) {
    this.wanderTicks.set(agentId, now)
  }

  maybeWanderAgent(agent: Agent, now: number, options?: { allowWhenBusy?: boolean }) {
    if (!IDLE_WANDER_ENABLED) return
    if (!options?.allowWhenBusy && agent.agentStatus !== "idle") return
    if (agent.isMoving || agent.pathIntent === "chat") return
    if (agent.seatedChairId) agent.clearSeat()
    const last = this.wanderTicks.get(agent.agentId) ?? 0
    if (now - last < WANDER_INTERVAL_MS) return
    const target = pickWanderTarget(
      agent.agentId,
      agent.grid,
      this.blocked,
      this.mapWidth,
      this.mapHeight,
      Math.floor(now / WANDER_INTERVAL_MS),
    )
    if (!target) return
    if (target.x === agent.grid.x && target.y === agent.grid.y) return
    agent.walkTo(target, this.blocked)
  }

  ensureBoundSeat(agent: Agent, now: number) {
    const chair = this.boundWorkstationChair(agent.agentId)
    if (!chair) return
    if (agent.seatedChairId === chair.id || agent.isMoving || agent.pendingSitChairId || agent.pathIntent === "chat") {
      return
    }
    const key = `bound:${agent.agentId}`
    const last = this.wanderTicks.get(key) ?? 0
    if (now - last < 2000) return
    this.wanderTicks.set(key, now)
    this.routeAgentToBoundSeat(agent)
  }

  ensureRetroFollowArchitect(agent: Agent, now: number, architectMoved: boolean) {
    if (agent.isMoving || agent.pathIntent === "chat") return
    const grid = this.retroFollowGridForAgent(agent.agentId)
    if (!grid) return
    if (agent.grid.x === grid.x && agent.grid.y === grid.y && !architectMoved) return
    const key = `retro-follow:${agent.agentId}`
    const last = this.wanderTicks.get(key) ?? 0
    if (!architectMoved && now - last < 2000) return
    this.wanderTicks.set(key, now)
    this.routeRetroAgentToArchitect(agent)
  }

  ensureDedicatedSeat(agent: Agent, now: number) {
    const chair = this.dedicatedChairForAgent(agent.agentId)
    if (!chair) return
    if (agent.seatedChairId === chair.id || agent.isMoving || agent.pendingSitChairId || agent.pathIntent === "chat") {
      return
    }
    const key = `dedicated:${agent.agentId}`
    const last = this.wanderTicks.get(key) ?? 0
    if (now - last < 2000) return
    this.wanderTicks.set(key, now)
    this.routeAgentToDedicatedSeat(agent)
  }

  ensureAgentSeated(agent: Agent, now?: number) {
    if (!agentShouldSitAtDesk(agent.agentStatus)) return
    if (agent.seatedChairId || agent.isMoving || agent.pendingSitChairId || agent.pathIntent === "chat") return
    if (now !== undefined) {
      const key = `seat:${agent.agentId}`
      const last = this.wanderTicks.get(key) ?? 0
      if (now - last < 2000) return
      this.wanderTicks.set(key, now)
    }
    this.routeAgentToWorkstation(agent)
  }

  agentLabelRecords() {
    return [...this.agents.values()].map((agent) => ({
      id: agent.agentId,
      name: agent.displayName,
      status: agent.agentStatus,
      selected: agent.selected,
      ...agentLabelAnchorsFromMatrix(agent.getWorldTransformMatrix()),
    }))
  }

  syncDomLabels() {
    getOfficeDomLabels()?.syncAgents(this.agentLabelRecords())
  }

  repositionDomLabels() {
    getOfficeDomLabels()?.repositionAgents(this.agentLabelRecords())
  }

  refreshLocale() {
    this.syncDomLabels()
  }

  refreshTextResolution() {}

  resolveAgentGrid(snapshot: PortalSnapshot, spawnId: string) {
    const record = snapshot.agents.find((agent) => agent.spawn_id === spawnId)
    if (record?.scope === "retro" && snapshot.retro?.active) {
      const grid = retroFollowGrid(
        record.spawn_id,
        snapshot.agents.filter((agent) => agent.scope === "retro").map((agent) => agent.spawn_id),
        this.architectGridForRetroFollow(),
        this.blocked,
        this.mapWidth,
        this.mapHeight,
      )
      if (grid) return grid
    }
    const slot = snapshot.office_layout?.bindings?.find((entry) => entry.spawn_id === spawnId)?.slot
    if (slot !== undefined) {
      const chair = this.chairs.get(`inner-${slot}`)
      if (chair) return chair.sitGrid
      const anchor = this.deskAnchors.find((entry) => entry.chairId === `inner-${slot}`)
      if (anchor) return anchor.grid
    }
    const spawn = this.tiledSpawns.get(spawnId)
    if (spawn) return spawn
    return { x: Math.floor(this.mapWidth / 2), y: Math.floor(this.mapHeight / 2) }
  }

  spawnAgent(def: AgentDef, grid: GridPoint) {
    const pos = gridCenter(grid)
    const agent = new Agent(this, pos.x, pos.y, def, grid)
    this.agents.set(def.id, agent)
    this.syncDomLabels()
    return agent
  }

  syncAgentsFromSnapshot(snapshot: PortalSnapshot) {
    const defs = agentDefsFromSnapshot(snapshot)
    const activeIds = new Set(defs.map((def) => def.id))

    for (const [id, agent] of [...this.agents.entries()]) {
      if (activeIds.has(id)) continue
      if (agent.seatedChairId) this.restoreChairDepth(agent.seatedChairId)
      this.chatQueues.delete(id)
      this.chatInFlight.delete(id)
      this.chatHomeGrid.delete(id)
      agent.destroy()
      this.agents.delete(id)
      if (this.selectedId === id) this.selectedId = ""
    }

    for (const def of defs) {
      const status = resolveAgentDisplayStatus({ spawnId: def.id, snapshotStatus: def.status })
      const existing = this.agents.get(def.id)
      if (existing) {
        existing.displayName = def.name
        if (existing.agentStatus !== status) {
          existing.setStatus(status)
          this.routeAgentForStatus(existing, status)
        }
        continue
      }
      const grid = this.resolveAgentGrid(snapshot, def.id)
      const agent = this.spawnAgent({ ...def, status }, grid)
      this.routeAgentForStatus(agent, status)
    }

    if (defs.length > 0 && !this.agents.has(this.selectedId)) {
      this.selectedId = defs[0]!.id
      this.highlightAgents([this.selectedId])
    }
    for (const agent of this.agents.values()) {
      const record = snapshot.agents.find((item) => item.spawn_id === agent.agentId)
      if (record?.scope === "retro") continue
      if (agent.seatedChairId || agent.isMoving) continue
      const boundChair = this.boundWorkstationChair(agent.agentId)
      if (boundChair) {
        const nearSit = Math.hypot(agent.x - agentSitWorld(boundChair).x, agent.y - agentSitWorld(boundChair).y) < 20
        if (nearSit && agentShouldSitAtDesk(agent.agentStatus)) this.applySit(agent, boundChair)
        continue
      }
      const anchor = workspaceAnchorAt(agent.agentId, agent.grid, this.deskAnchors)
      if (!anchor?.chairId) continue
      const chair = this.chairs.get(anchor.chairId)
      if (!chair) continue
      const nearSit = Math.hypot(agent.x - agentSitWorld(chair).x, agent.y - agentSitWorld(chair).y) < 20
      if (nearSit && agentShouldSitAtDesk(agent.agentStatus)) this.applySit(agent, chair)
    }
    for (const agent of this.agents.values()) {
      const record = snapshot.agents.find((item) => item.spawn_id === agent.agentId)
      if (record?.scope === "retro") continue
      if (this.dedicatedChairForAgent(agent.agentId)) continue
      if (this.boundWorkstationChair(agent.agentId)) continue
      if (this.isOverflowInnerAgent(agent.agentId)) continue
      this.ensureAgentSeated(agent)
    }
    this.syncDomLabels()
  }

  syncFromSnapshot(snapshot: PortalSnapshot) {
    this.syncAgentsFromSnapshot(snapshot)
  }

  readCollision(map: Phaser.Tilemaps.Tilemap) {
    const layer = map.getLayer("collision")?.tilemapLayer
    const blocked: boolean[][] = []
    for (let y = 0; y < map.height; y++) {
      const row: boolean[] = []
      for (let x = 0; x < map.width; x++) {
        const tile = layer?.getTileAt(x, y)
        row.push(tile?.index === BLOCKED_TILE_INDEX)
      }
      blocked.push(row)
    }
    return blocked
  }

  highlightAgents(ids: string[]) {
    const primary = ids[0] ?? this.selectedId
    this.selectedId = primary
    const picked = new Set(ids)
    for (const [agentId, agent] of this.agents) agent.setSelected(picked.has(agentId))
    this.syncDomLabels()
  }

  selectAgent(spawnId: string, clickClientX?: number) {
    this.highlightAgents([spawnId])
    this.emitAgentSelection(spawnId, clickClientX)
  }

  clearAgentSelection() {
    for (const agent of this.agents.values()) agent.setSelected(false)
    this.syncDomLabels()
  }

  emitAgentSelection(spawnId: string, clickClientX?: number) {
    const snapshot = getPortalSnapshot()
    if (!snapshot) return
    const record = snapshot.agents.find((agent) => agent.spawn_id === spawnId)
    if (!record) return
    const live = this.agents.get(spawnId)
    emitAgentSelectedFromMap({
      spawnId: record.spawn_id,
      name: record.display_name,
      status: live?.agentStatus ?? record.status,
      nodeId: record.node_id,
      profile: record.profile,
      scope: record.scope,
      panelSide: agentDetailPanelSide(clickClientX),
      ...(record.description && { description: record.description }),
      ...(record.skills && { skills: record.skills }),
    })
  }

  setAgentStatus(spawnId: string, status: AgentStatus) {
    const agent = this.agents.get(spawnId)
    if (!agent || agent.agentStatus === status) return
    agent.setStatus(status)
    this.routeAgentForStatus(agent, status)
    this.syncDomLabels()
    refreshAgentOverlayIfOpen(spawnId, status)
  }

  handleAgentChat(fromSpawnId: string, toSpawnId: string, text: string) {
    const sender = this.agents.get(fromSpawnId)
    const receiver = this.agents.get(toSpawnId)
    if (!sender || !receiver) return

    const queue = this.chatQueues.get(fromSpawnId) ?? []
    queue.push({ toSpawnId, text })
    this.chatQueues.set(fromSpawnId, queue)
    if (this.chatInFlight.has(fromSpawnId)) return
    this.drainChatQueue(fromSpawnId)
  }

  drainChatQueue(fromSpawnId: string) {
    const sender = this.agents.get(fromSpawnId)
    if (!sender) return

    const queue = this.chatQueues.get(fromSpawnId)
    const item = queue?.shift()
    if (!item) {
      this.chatQueues.delete(fromSpawnId)
      this.finishChatBatch(fromSpawnId, sender)
      return
    }
    if (!queue?.length) this.chatQueues.delete(fromSpawnId)

    const receiver = this.agents.get(item.toSpawnId)
    if (!receiver) {
      this.drainChatQueue(fromSpawnId)
      return
    }

    if (!this.chatInFlight.has(fromSpawnId)) {
      this.chatInFlight.add(fromSpawnId)
      sender.pathIntent = "chat"
      this.chatHomeGrid.set(fromSpawnId, { x: sender.grid.x, y: sender.grid.y })
    }

    const afterBubble = () => {
      if (this.chatQueues.get(fromSpawnId)?.length) {
        this.drainChatQueue(fromSpawnId)
        return
      }
      this.finishChatBatch(fromSpawnId, sender)
    }

    const showBubbleAtRecipient = () => {
      const labels = getOfficeDomLabels()
      if (!labels?.agents.has(fromSpawnId)) {
        setTimeout(afterBubble, CHAT_BUBBLE_MS)
        return
      }
      labels.showChatBubble(fromSpawnId, item.text, afterBubble)
    }

    this.beginChatChase(fromSpawnId, item.toSpawnId, showBubbleAtRecipient, this.time.now)
  }

  beginChatChase(fromSpawnId: string, toSpawnId: string, onArrived: () => void, now: number) {
    const sender = this.agents.get(fromSpawnId)
    const receiver = this.agents.get(toSpawnId)
    if (!sender || !receiver) {
      onArrived()
      return
    }

    sender.clearSeat()
    sender.pendingSitChairId = undefined
    sender.pathDone = undefined
    sender.pathIntent = "chat"

    const chase: ChatChaseState = {
      toSpawnId,
      onArrived,
      lastRepathAt: 0,
      startedAt: now,
    }
    this.chatChaseTargets.set(fromSpawnId, chase)
    this.repathChatChase(fromSpawnId, chase, now)
  }

  repathChatChase(fromSpawnId: string, chase: ChatChaseState, now: number) {
    const sender = this.agents.get(fromSpawnId)
    const receiver = this.agents.get(chase.toSpawnId)
    if (!sender || !receiver) {
      this.completeChatChase(fromSpawnId)
      return
    }

    const receiverGrid = receiver.grid
    if (senderAdjacentToReceiver(sender.grid, receiverGrid)) {
      this.completeChatChase(fromSpawnId)
      return
    }

    const target = nearestWalkableAdjacent(
      sender.grid,
      receiverGrid,
      this.blocked,
      this.mapWidth,
      this.mapHeight,
    )
    if (!target) {
      if (!sender.isMoving) this.completeChatChase(fromSpawnId)
      return
    }

    chase.lastReceiverGrid = { x: receiverGrid.x, y: receiverGrid.y }
    chase.lastRepathAt = now
    if (sender.setChatPath(target, this.blocked)) this.completeChatChase(fromSpawnId)
  }

  updateChatChases(now: number) {
    for (const [fromSpawnId, chase] of this.chatChaseTargets) {
      const sender = this.agents.get(fromSpawnId)
      const receiver = this.agents.get(chase.toSpawnId)
      if (!sender || !receiver) {
        this.completeChatChase(fromSpawnId)
        continue
      }

      if (now - chase.startedAt >= CHAT_CHASE_MAX_MS) {
        sender.pathWorld = []
        this.completeChatChase(fromSpawnId)
        continue
      }

      if (senderAdjacentToReceiver(sender.grid, receiver.grid)) {
        this.completeChatChase(fromSpawnId)
        continue
      }

      const receiverGrid = receiver.grid
      const receiverMoved =
        !chase.lastReceiverGrid ||
        chase.lastReceiverGrid.x !== receiverGrid.x ||
        chase.lastReceiverGrid.y !== receiverGrid.y
      if (!receiverMoved) {
        if (sender.isMoving) continue
        if (now - chase.lastRepathAt < CHAT_CHASE_REPATH_MS) continue
      }

      this.repathChatChase(fromSpawnId, chase, now)
    }
  }

  tryCompleteChatChaseIfAdjacent(fromSpawnId: string) {
    const chase = this.chatChaseTargets.get(fromSpawnId)
    if (!chase) return false
    const sender = this.agents.get(fromSpawnId)
    const receiver = this.agents.get(chase.toSpawnId)
    if (!sender || !receiver || !senderAdjacentToReceiver(sender.grid, receiver.grid)) return false
    sender.pathWorld = []
    sender.pathDone = undefined
    this.completeChatChase(fromSpawnId)
    return true
  }

  completeChatChase(fromSpawnId: string) {
    const chase = this.chatChaseTargets.get(fromSpawnId)
    if (!chase) return
    this.chatChaseTargets.delete(fromSpawnId)
    const sender = this.agents.get(fromSpawnId)
    const receiver = this.agents.get(chase.toSpawnId)
    if (sender) {
      sender.pathWorld = []
      sender.pathDone = undefined
    }
    if (
      sender &&
      receiver &&
      senderAdjacentToReceiver(sender.grid, receiver.grid)
    ) {
      sender.facing = facingFromGridDelta(receiver.grid.x - sender.grid.x, receiver.grid.y - sender.grid.y)
      sender.syncBehavior()
    }
    chase.onArrived()
  }

  finishChatBatch(fromSpawnId: string, sender: Agent) {
    if (this.chatQueues.get(fromSpawnId)?.length) {
      this.drainChatQueue(fromSpawnId)
      return
    }
    const home = this.chatHomeGrid.get(fromSpawnId)
    this.chatHomeGrid.delete(fromSpawnId)
    this.chatChaseTargets.delete(fromSpawnId)
    const complete = () => {
      this.chatInFlight.delete(fromSpawnId)
      this.chatChaseTargets.delete(fromSpawnId)
      sender.pathIntent = undefined
      sender.pathDone = undefined
      sender.pathWorld = []
      if (this.chatQueues.get(fromSpawnId)?.length) {
        this.drainChatQueue(fromSpawnId)
        return
      }
      this.routeAgentForStatus(sender, sender.agentStatus)
    }
    if (!home || (sender.grid.x === home.x && sender.grid.y === home.y)) {
      complete()
      return
    }
    sender.walkToThen(home, this.blocked, complete)
  }

  applySnapshot(snapshot: PortalSnapshot) {
    if (!this.texturesReady) return
    const layout = snapshot.office_layout
    if (layout && (!layout.ready || (this.layoutRevision && layout.revision !== this.layoutRevision))) return
    this.syncFromSnapshot(snapshot)
  }

  override update(_time: number, delta: number) {
    this.updateChatChases(_time)
    for (const agent of this.agents.values()) {
      agent.updateAgent(_time, delta)
    }
    const retroActive = this.retroMeetingActive()
    const architectGrid = retroActive ? this.architectGridForRetroFollow() : undefined
    const architectMoved =
      retroActive &&
      architectGrid !== undefined &&
      (!this.retroFollowArchitectGrid ||
        this.retroFollowArchitectGrid.x !== architectGrid.x ||
        this.retroFollowArchitectGrid.y !== architectGrid.y)
    if (architectGrid) this.retroFollowArchitectGrid = architectGrid
    for (const agent of this.agents.values()) {
      const record = getPortalSnapshot()?.agents.find((item) => item.spawn_id === agent.agentId)
      if (record?.scope === "retro") {
        this.ensureRetroFollowArchitect(agent, _time, architectMoved === true)
        continue
      }
      if (record?.scope === "outer") {
        if (agent.agentStatus === "idle" && IDLE_WANDER_ENABLED) this.maybeWanderAgent(agent, _time)
        else this.ensureDedicatedSeat(agent, _time)
        continue
      }
      if (this.boundWorkstationChair(agent.agentId)) {
        if (agent.agentStatus === "idle" && IDLE_WANDER_ENABLED) this.maybeWanderAgent(agent, _time)
        else this.ensureBoundSeat(agent, _time)
        continue
      }
      if (this.isOverflowInnerAgent(agent.agentId)) {
        if (IDLE_WANDER_ENABLED) this.maybeWanderAgent(agent, _time, { allowWhenBusy: true })
        continue
      }
      if (agentShouldSitAtDesk(agent.agentStatus)) this.ensureAgentSeated(agent, _time)
      else if (IDLE_WANDER_ENABLED) this.maybeWanderAgent(agent, _time)
    }
    getOfficeDomLabels()?.syncLayout()
    this.repositionDomLabels()
  }
}

function agentDefsFromSnapshot(snapshot: PortalSnapshot) {
  return officeAgentsFromSnapshot(snapshot).map((agent) => {
    const record = snapshot.agents.find((item) => item.spawn_id === agent.spawnId)
    return {
      id: agent.spawnId,
      name: agent.name,
      atlasPrefix: agent.atlasPrefix,
      status: agent.status,
      fixed: agent.fixed,
      ghost: agent.ghost,
      scope: record?.scope,
      ...(record?.mission_id && { missionId: record.mission_id }),
      ...(record?.node_id && { nodeId: record.node_id }),
    }
  })
}

function senderAdjacentToReceiver(sender: GridPoint, receiver: GridPoint) {
  return Math.abs(sender.x - receiver.x) + Math.abs(sender.y - receiver.y) === 1
}

/** Prefer the walkable tile beside the receiver that lies between sender and receiver. */
function chatAdjacentOnApproachSide(sender: GridPoint, receiver: GridPoint, candidate: GridPoint) {
  const dx = Math.sign(sender.x - receiver.x)
  const dy = Math.sign(sender.y - receiver.y)
  if (candidate.x !== receiver.x) {
    const cx = Math.sign(candidate.x - receiver.x)
    if (dx !== 0 && cx !== dx) return false
  }
  if (candidate.y !== receiver.y) {
    const cy = Math.sign(candidate.y - receiver.y)
    if (dy !== 0 && cy !== dy) return false
  }
  return true
}

function nearestWalkableAdjacent(
  from: GridPoint,
  to: GridPoint,
  blocked: boolean[][],
  mapWidth: number,
  mapHeight: number,
) {
  if (
    senderAdjacentToReceiver(from, to) &&
    from.x >= 0 &&
    from.y >= 0 &&
    from.x < mapWidth &&
    from.y < mapHeight &&
    !blocked[from.y]?.[from.x]
  ) {
    return from
  }

  const candidates = [
    { x: to.x - 1, y: to.y },
    { x: to.x + 1, y: to.y },
    { x: to.x, y: to.y - 1 },
    { x: to.x, y: to.y + 1 },
  ].filter(
    (point) =>
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < mapWidth &&
      point.y < mapHeight &&
      !blocked[point.y]?.[point.x] &&
      !(point.x === from.x && point.y === from.y),
  )
  if (candidates.length === 0) return undefined
  const approachSide = candidates.filter((point) => chatAdjacentOnApproachSide(from, to, point))
  const pool = approachSide.length > 0 ? approachSide : candidates
  return pool.sort(
    (a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)),
  )[0]
}

function pointerClientX(pointer: Phaser.Input.Pointer) {
  const event = pointer.event
  if (event instanceof MouseEvent) return event.clientX
  if (event instanceof TouchEvent) return event.changedTouches[0]?.clientX ?? event.touches[0]?.clientX
  return undefined
}

function agentDetailPanelSide(clickClientX?: number) {
  if (clickClientX === undefined) return "right" as const
  const stack = document.getElementById("office-game-stack")
  if (!stack) return "right" as const
  const rect = stack.getBoundingClientRect()
  if (rect.width <= 0) return "right" as const
  return clickClientX - rect.left < rect.width / 2 ? ("right" as const) : ("left" as const)
}
