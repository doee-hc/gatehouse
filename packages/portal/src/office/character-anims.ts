import type { BehaviorKind } from "./behaviors.ts"
import type { CharacterAtlasPrefix } from "./characters.ts"
import { characterSheetTextureKey } from "./character-sheets.ts"

export type Facing = "down" | "up" | "left" | "right"

const DIRECTIONAL_ANIMS = ["idle", "run", "sit"] as const

export function atlasFrameKey(prefix: CharacterAtlasPrefix, anim: string, frame: number) {
  return `${prefix}_${anim}_${frame}`
}

export function registerCharacterAnims(scene: Phaser.Scene, prefixes: CharacterAtlasPrefix[]) {
  for (const prefix of prefixes) {
    const textureKey = characterSheetTextureKey(prefix)
    if (!scene.textures.exists(textureKey)) continue
    const texture = scene.textures.get(textureKey)
    for (const base of DIRECTIONAL_ANIMS) {
      for (const dir of ["down", "left", "right", "up"] as Facing[]) {
        const anim = `${base}_${dir}`
        const behavior = base === "run" ? "run" : base === "sit" ? "sit" : "stand"
        const phaserKey = characterAnimKey(prefix, behavior, dir, base === "run")
        if (scene.anims.exists(phaserKey)) continue
        const frames = texture
          .getFrameNames()
          .filter((name) => name.startsWith(`${prefix}_${anim}_`))
          .sort()
        if (frames.length === 0) continue
        scene.anims.create({
          key: phaserKey,
          frames: frames.map((frame) => ({ key: textureKey, frame })),
          frameRate: base === "run" ? 10 : 5,
          repeat: -1,
        })
      }
    }
  }
}

export function behaviorToAtlasAnim(behavior: BehaviorKind, facing: Facing, isMoving: boolean) {
  if (isMoving || behavior === "run") return `run_${facing}` as const
  if (behavior === "sit") return `sit_${facing}` as const
  if (behavior === "typing") return `idle_${facing}` as const
  return `idle_${facing}` as const
}

export function characterAnimKey(prefix: CharacterAtlasPrefix, behavior: BehaviorKind, facing: Facing, isMoving: boolean) {
  const anim = behaviorToAtlasAnim(behavior, facing, isMoving)
  return `${prefix}_mv_${anim}`
}

export function facingFromVelocity(dx: number, dy: number, current: Facing): Facing {
  if (dx === 0 && dy === 0) return current
  return facingFromGridDelta(dx, dy)
}

export function facingFromGridDelta(dx: number, dy: number): Facing {
  if (dx === 0 && dy === 0) return "down"
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left"
  return dy > 0 ? "down" : "up"
}

export function characterSpriteFrame(
  scene: Phaser.Scene,
  prefix: CharacterAtlasPrefix,
  behavior: BehaviorKind,
  facing: Facing,
  isMoving: boolean,
) {
  const textureKey = characterSheetTextureKey(prefix)
  const anim = behaviorToAtlasAnim(behavior, facing, isMoving)
  const frame = atlasFrameKey(prefix, anim, 0)
  if (scene.textures.exists(textureKey) && scene.textures.get(textureKey).has(frame)) {
    return { textureKey, frame }
  }
  const fallback = atlasFrameKey(prefix, "idle_down", 0)
  if (scene.textures.exists(textureKey) && scene.textures.get(textureKey).has(fallback)) {
    return { textureKey, frame: fallback }
  }
  return { textureKey, frame }
}
