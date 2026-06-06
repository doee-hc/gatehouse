/**
 * Generate outer (4 fixed) + inner pool (32) in one step.
 * Requires Character_Generator outside the repo (see README).
 */
import path from "node:path"

const pkgRoot = path.join(import.meta.dir, "..")

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: pkgRoot, stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) process.exit(proc.exitCode ?? 1)
}

const seed = process.env.CHARACTER_POOL_SEED
const poolArgs = ["python3", "script/generate-pool.py", "--count", "32"]
if (seed) poolArgs.push("--seed", seed)

console.log("[character-assets] compose outer roles…")
await run(["python3", "script/compose-character-sheets.py", "--recipes", "script/outer-recipes.json", "--out-dir", "assets/outer"])

console.log("[character-assets] generate inner pool…")
await run(poolArgs)

console.log("[character-assets] syncing to portal sheets…")
await run(["bun", "script/sync-portal.ts"])

console.log("[character-assets] done")
