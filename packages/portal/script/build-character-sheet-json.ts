/**
 * Regenerate Phaser atlas JSON for fixed 12×6 per-role sheets (32×64 cells).
 * PNG unchanged — only writes {role}-1x1.json under public/assets/characters/sheets/.
 */
import path from "node:path"
import { loadCharacterRoles } from "./character-roles.ts"

const pkgRoot = path.join(import.meta.dir, "..")
const outDir = path.join(pkgRoot, "public", "assets", "characters", "sheets")
const ROLES = await loadCharacterRoles(pkgRoot)

const GRID_COLS = 12
const GRID_ROWS = 6
const CELL_W = 32
const CELL_H = 64
const ANIM_ORDER = ["idle", "run", "sit"] as const
const DIR_ORDER = ["down", "left", "right", "up"] as const
const FRAMES_PER_GROUP = 6

const sheetW = GRID_COLS * CELL_W
const sheetH = GRID_ROWS * CELL_H

function frameKeys(role: string) {
  const keys: string[] = []
  for (const anim of ANIM_ORDER) {
    for (const dir of DIR_ORDER) {
      for (let i = 0; i < FRAMES_PER_GROUP; i++) {
        keys.push(`${role}_${anim}_${dir}_${i}`)
      }
    }
  }
  return keys
}

for (const role of ROLES) {
  const keys = frameKeys(role)
  const frames: Record<string, object> = {}
  keys.forEach((key, i) => {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    const x = col * CELL_W
    const y = row * CELL_H
    frames[key] = {
      frame: { x, y, w: CELL_W, h: CELL_H },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CELL_W, h: CELL_H },
      sourceSize: { w: CELL_W, h: CELL_H },
    }
  })

  const image = `${role}-1x1.png`
  await Bun.write(
    path.join(outDir, `${role}-1x1.json`),
    `${JSON.stringify(
      {
        frames,
        meta: {
          app: "@gatehouse/portal/build-character-sheet-json",
          version: "1.0",
          image,
          format: "RGBA8888",
          size: { w: sheetW, h: sheetH },
          scale: "1",
        },
      },
      null,
      2,
    )}\n`,
  )
  console.log(`${role}-1x1.json (${keys.length} frames)`)
}
